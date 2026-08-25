import pLimit from "p-limit";
import { appConfig, mergeStrategySettings } from "../config.js";
import { isWeekendIst, subtractDays } from "../dates.js";
import { prisma } from "../db.js";
import { logLine, friendlyError } from "../logger.js";
import { getCachedCandles } from "../market/candleCache.js";
import { YahooFinanceProvider } from "../market/YahooFinanceProvider.js";
import { evaluateStrategy } from "../strategy.js";
import type { ProviderLog, StockUniverseItem, StrategyEvaluation, StrategySettings, UniverseKey } from "../types.js";
import { loadStockUniverse } from "./universe.js";

export interface ScanOptions extends Partial<StrategySettings> {
  symbols?: string[];
  limit?: number;
  universe?: UniverseKey;
  forceUniverseRefresh?: boolean;
  persistResults?: boolean;
}

export interface ScanProgress {
  runId?: number;
  status: "idle" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  message: string;
  startedAt?: string;
  endedAt?: string;
}

const SCAN_PROGRESS_DB_UPDATE_EVERY = 25;

export async function runScan(
  options: ScanOptions = {},
  onProgress?: (progress: ScanProgress) => void
): Promise<{ runId: number; results: StrategyEvaluation[]; logs: ProviderLog[] }> {
  const logs: ProviderLog[] = [];
  const provider = new YahooFinanceProvider();
  const settings = mergeStrategySettings(options);
  const universeKey = options.universe ?? "nifty200";
  const persistResults = options.persistResults !== false;
  const startedAt = new Date();
  const run = await prisma.scanRun.create({
    data: {
      status: "RUNNING",
      settingsJson: JSON.stringify({
        ...settings,
        universe: universeKey,
        symbols: options.symbols,
        limit: options.limit,
        persistResults
      }),
      provider: provider.name
    }
  });

  const progress: ScanProgress = {
    runId: run.id,
    status: "running",
    total: 0,
    completed: 0,
    failed: 0,
    message: "Scan started",
    startedAt: startedAt.toISOString()
  };
  onProgress?.(progress);
  logLine(logs, "info", "Scan started", { runId: run.id });

  try {
    if (isWeekendIst()) {
      throw new Error("NSE scans are disabled on weekends.");
    }

    const universe = await loadStockUniverse(universeKey, Boolean(options.forceUniverseRefresh));
    if (universe.warning) logLine(logs, "warn", universe.warning);
    logLine(logs, "info", `${universe.label} loaded from ${universe.source}`, { count: universe.stocks.length });

    const requested = selectStocks(universe.stocks, options);
    progress.total = requested.length;
    progress.message = `Scanning ${requested.length} stocks`;
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        totalStocks: requested.length,
        logJson: JSON.stringify(logs)
      }
    });
    onProgress?.({ ...progress });

    const limiter = pLimit(appConfig.providerConcurrency);
    const now = new Date();
    const intradayStart = subtractDays(now, appConfig.scanLookbackDays);
    const dailyStart = subtractDays(now, appConfig.dailyLookbackDays);
    const end = new Date(now.getTime() + 20 * 60_000);

    const results = await Promise.all(
      requested.map((stock) =>
        limiter(async () => {
          const result = await scanStock(stock, settings, provider, intradayStart, dailyStart, end, logs);
          progress.completed += 1;
          if (result.conditions.some((condition) => condition.key === "requiredData" && !condition.passed)) {
            progress.failed += 1;
          }
          progress.message = `${progress.completed}/${progress.total} stocks completed`;
          if (shouldPersistScanProgress(progress.completed, progress.total)) {
            await prisma.scanRun.update({
              where: { id: run.id },
              data: {
                completedStocks: progress.completed,
                failedStocks: progress.failed,
                logJson: JSON.stringify(logs)
              }
            });
          }
          onProgress?.({ ...progress });
          return result;
        })
      )
    );

    if (persistResults) {
      progress.message = "Saving scan results";
      onProgress?.({ ...progress });
      await persistScanResults(run.id, results);
    } else {
      logLine(logs, "info", "Full scan result persistence skipped for this run.");
    }

    progress.status = "completed";
    progress.endedAt = new Date().toISOString();
    progress.message = "Scan completed";
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        completedStocks: progress.completed,
        failedStocks: progress.failed,
        logJson: JSON.stringify(logs)
      }
    });
    logLine(logs, "info", "Scan completed", {
      runId: run.id,
      buy: results.filter((result) => result.category === "BUY").length,
      watch: results.filter((result) => result.category === "WATCH").length
    });
    onProgress?.({ ...progress });

    return { runId: run.id, results, logs };
  } catch (error) {
    progress.status = "failed";
    progress.endedAt = new Date().toISOString();
    progress.message = friendlyError(error);
    logLine(logs, "error", "Scan failed", { error: friendlyError(error) });
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        endedAt: new Date(),
        errorMessage: friendlyError(error),
        logJson: JSON.stringify(logs)
      }
    });
    onProgress?.({ ...progress });
    throw error;
  }
}

async function persistScanResults(scanRunId: number, results: StrategyEvaluation[]) {
  for (const result of results) {
    await persistScanResult(scanRunId, result);
  }
}

function selectStocks(stocks: StockUniverseItem[], options: ScanOptions): StockUniverseItem[] {
  let selected = stocks;
  if (options.symbols?.length) {
    const wanted = new Set(options.symbols.map((symbol) => symbol.toUpperCase().replace(/\.NS$/, "")));
    selected = selected.filter((stock) => wanted.has(stock.symbol.toUpperCase()));
  }
  if (options.limit && options.limit > 0) {
    selected = selected.slice(0, options.limit);
  }
  return selected;
}

function shouldPersistScanProgress(completed: number, total: number): boolean {
  return completed === total || completed % SCAN_PROGRESS_DB_UPDATE_EVERY === 0;
}

async function scanStock(
  stock: StockUniverseItem,
  settings: StrategySettings,
  provider: YahooFinanceProvider,
  intradayStart: Date,
  dailyStart: Date,
  end: Date,
  logs: ProviderLog[]
): Promise<StrategyEvaluation> {
  try {
    const [intraday, daily] = await Promise.all([
      getCachedCandles(provider, stock.yahooSymbol, "15m", intradayStart, end),
      getCachedCandles(provider, stock.yahooSymbol, "1d", dailyStart, end)
    ]);
    Array.from(new Set([...intraday.warnings, ...daily.warnings])).forEach((warning) =>
      logLine(logs, warning.includes("failed") ? "warn" : "info", `${stock.symbol}: ${warning}`)
    );

    const evaluation = evaluateStrategy({
      stock,
      candles: intraday.candles,
      dailyCandles: daily.candles,
      settings
    });

    if (intraday.warnings.length || daily.warnings.length) {
      evaluation.pending.push(...intraday.warnings, ...daily.warnings);
    }
    return evaluation;
  } catch (error) {
    const evaluation = evaluateStrategy({
      stock,
      candles: [],
      dailyCandles: [],
      settings
    });
    evaluation.pending.push(friendlyError(error));
    logLine(logs, "error", `${stock.symbol}: provider or indicator failure`, { error: friendlyError(error) });
    return evaluation;
  }
}

async function persistScanResult(scanRunId: number, result: StrategyEvaluation) {
  const trade = result.trade;
  const row = await prisma.scanResult.create({
    data: {
      scanRunId,
      stockSymbol: result.symbol,
      companyName: result.companyName,
      sector: result.sector ?? null,
      category: result.category,
      score: result.score,
      close: value(result.indicators.close),
      vwap: value(result.indicators.vwap),
      ema20: value(result.indicators.ema20),
      ema200: value(result.indicators.ema200),
      previousHigh: value(result.indicators.previousHigh),
      previousLow: value(result.indicators.previousLow),
      previousClose: value(result.indicators.previousClose),
      pivot: value(result.indicators.pivot),
      r1: value(result.indicators.r1),
      s1: value(result.indicators.s1),
      r2: value(result.indicators.r2),
      s2: value(result.indicators.s2),
      r3: value(result.indicators.r3),
      s3: value(result.indicators.s3),
      volumeRatio: value(result.volumeRatio),
      breakoutLevel: value(result.breakoutLevel),
      breakoutType: result.breakoutType,
      signalTime: result.signalTime,
      entry: trade?.entry,
      target1: trade?.target1,
      target2: trade?.target2,
      stopLoss: trade?.stopLoss,
      quantity: trade?.quantity,
      investment: trade?.investment,
      profitTarget1Gross: trade?.profitTarget1Gross,
      profitTarget2Gross: trade?.profitTarget2Gross,
      maxLossGross: trade?.maxLossGross,
      riskReward: trade?.riskReward,
      distanceBreakout: trade?.distanceBreakout,
      capitalUnused: trade?.capitalUnused,
      estimatedCharges: trade?.estimatedCharges,
      netProfitTarget2: trade?.netProfitTarget2,
      failedCount: result.failedCount,
      liquidity: value(result.liquidity),
      reasonsJson: JSON.stringify(result.reasons),
      pendingJson: JSON.stringify(result.pending),
      conditions: {
        create: result.conditions.map((condition) => ({
          key: condition.key,
          label: condition.label,
          passed: condition.passed,
          message: condition.message,
          sortOrder: condition.sortOrder
        }))
      },
      indicators: {
        create: Object.entries(result.indicators).map(([key, indicatorValue]) => ({
          key,
          value: value(indicatorValue)
        }))
      }
    }
  });

  if (result.category === "BUY" && result.breakoutType && result.breakoutLevel && result.latestCandle) {
    await prisma.signal.upsert({
      where: {
        symbol_tradingDate_breakoutType: {
          symbol: result.symbol,
          tradingDate: result.latestCandle.tradingDate,
          breakoutType: result.breakoutType
        }
      },
      update: {
        scanResultId: row.id,
        breakoutLevel: result.breakoutLevel
      },
      create: {
        symbol: result.symbol,
        tradingDate: result.latestCandle.tradingDate,
        breakoutType: result.breakoutType,
        breakoutLevel: result.breakoutLevel,
        scanResultId: row.id
      }
    });
  }
}

function value(input: number | null | undefined): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}
