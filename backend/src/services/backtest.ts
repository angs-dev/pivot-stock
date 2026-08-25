import pLimit from "p-limit";
import { appConfig, mergeStrategySettings } from "../config.js";
import { dateFromIstParts, monthKey, subtractDays, timeKey } from "../dates.js";
import { prisma } from "../db.js";
import { friendlyError, logLine } from "../logger.js";
import { getCachedCandles } from "../market/candleCache.js";
import { YahooFinanceProvider } from "../market/YahooFinanceProvider.js";
import { evaluateStrategy } from "../strategy.js";
import { estimateCharges, calculateTradePlan, roundMoney } from "../trade.js";
import type {
  BacktestSettings,
  BacktestTradeResult,
  Candle,
  ProviderLog,
  StockUniverseItem,
  StrategySettings,
  UniverseKey
} from "../types.js";
import { loadStockUniverse } from "./universe.js";

export interface BacktestOptions extends Partial<BacktestSettings> {
  symbols?: string[];
  limit?: number;
  universe?: UniverseKey;
}

export interface BacktestProgress {
  runId?: number;
  status: "idle" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  missing: number;
  message: string;
  startedAt?: string;
  endedAt?: string;
}

export async function runBacktest(
  options: BacktestOptions = {},
  onProgress?: (progress: BacktestProgress) => void
): Promise<{ runId: number; trades: BacktestTradeResult[]; logs: ProviderLog[] }> {
  const provider = new YahooFinanceProvider();
  const now = new Date();
  const defaultEnd = now.toISOString().slice(0, 10);
  const defaultStart = subtractDays(now, 30).toISOString().slice(0, 10);
  const settings: BacktestSettings = {
    ...mergeStrategySettings(options),
    startDate: options.startDate ?? defaultStart,
    endDate: options.endDate ?? defaultEnd,
    symbols: options.symbols,
    limit: options.limit,
    universe: options.universe ?? "nifty200"
  };
  const logs: ProviderLog[] = [];
  const run = await prisma.backtestRun.create({
    data: {
      status: "RUNNING",
      startDate: settings.startDate,
      endDate: settings.endDate,
      settingsJson: JSON.stringify(settings)
    }
  });
  const progress: BacktestProgress = {
    runId: run.id,
    status: "running",
    total: 0,
    completed: 0,
    missing: 0,
    message: "Backtest started",
    startedAt: new Date().toISOString()
  };
  onProgress?.({ ...progress });
  logLine(logs, "info", "Backtest started", { runId: run.id, startDate: settings.startDate, endDate: settings.endDate });

  try {
    const universe = await loadStockUniverse(settings.universe ?? "nifty200", false);
    if (universe.warning) logLine(logs, "warn", universe.warning);
    const selected = selectStocks(universe.stocks, settings);
    progress.total = selected.length;
    progress.message = `Testing ${selected.length} symbols`;
    await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        symbolsRequested: selected.length,
        logJson: JSON.stringify(logs)
      }
    });
    onProgress?.({ ...progress });

    const limit = pLimit(Math.max(1, Math.min(appConfig.providerConcurrency, 3)));
    const startDate = dateFromIstParts(settings.startDate, "09:15");
    const endDate = dateFromIstParts(settings.endDate, "23:59");
    const yahooIntradayFloor = subtractDays(new Date(), 58);
    const fetchStart = new Date(
      Math.max(subtractDays(startDate, appConfig.scanLookbackDays).getTime(), yahooIntradayFloor.getTime())
    );
    const dailyStart = subtractDays(startDate, appConfig.dailyLookbackDays);
    const missingSymbols: string[] = [];

    const symbolResults = await Promise.all(
      selected.map((stock) =>
        limit(async () => {
          const result = await backtestSymbol(stock, settings, provider, fetchStart, dailyStart, endDate, startDate, logs);
          progress.completed += 1;
          if (result.missingReason) {
            progress.missing += 1;
            missingSymbols.push(`${stock.symbol}: ${result.missingReason}`);
          }
          progress.message = `${progress.completed}/${progress.total} symbols tested`;
          await prisma.backtestRun.update({
            where: { id: run.id },
            data: {
              symbolsTested: progress.completed - progress.missing,
              missingSymbolsJson: JSON.stringify(missingSymbols),
              logJson: JSON.stringify(logs)
            }
          });
          onProgress?.({ ...progress });
          return result;
        })
      )
    );

    const trades = symbolResults.flatMap((result) => result.trades);
    const summary = summarizeBacktest(trades, selected.length, selected.length - missingSymbols.length, missingSymbols);

    if (trades.length > 0) {
      await prisma.backtestTrade.createMany({
        data: trades.map((trade) => ({
          backtestRunId: run.id,
          symbol: trade.symbol,
          signalTime: trade.signalTime,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          quantity: trade.quantity,
          target: trade.target,
          stopLoss: trade.stopLoss,
          exitReason: trade.exitReason,
          grossProfit: trade.grossProfit,
          charges: trade.charges,
          netProfit: trade.netProfit,
          returnPct: trade.returnPct,
          score: trade.score,
          breakoutType: trade.breakoutType,
          breakoutLevel: trade.breakoutLevel
        }))
      });
    }

    await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        symbolsRequested: selected.length,
        symbolsTested: selected.length - missingSymbols.length,
        missingSymbolsJson: JSON.stringify(missingSymbols),
        totalSignals: summary.totalSignals,
        totalTrades: summary.totalTrades,
        winningTrades: summary.winningTrades,
        losingTrades: summary.losingTrades,
        winRate: summary.winRate,
        grossProfit: summary.grossProfit,
        totalCharges: summary.totalCharges,
        netProfit: summary.netProfit,
        averageProfit: summary.averageProfit,
        averageReturn: summary.averageReturn,
        bestTrade: summary.bestTrade,
        worstTrade: summary.worstTrade,
        consecutiveWins: summary.consecutiveWins,
        consecutiveLosses: summary.consecutiveLosses,
        maxDrawdown: summary.maxDrawdown,
        profitFactor: summary.profitFactor,
        targetHitCount: summary.targetHitCount,
        stopLossHitCount: summary.stopLossHitCount,
        timeExitCount: summary.timeExitCount,
        monthlyPerformanceJson: JSON.stringify(summary.monthlyPerformance),
        symbolPerformanceJson: JSON.stringify(summary.symbolPerformance),
        equityCurveJson: JSON.stringify(summary.equityCurve),
        logJson: JSON.stringify(logs)
      }
    });

    progress.status = "completed";
    progress.endedAt = new Date().toISOString();
    progress.message = "Backtest completed";
    logLine(logs, "info", "Backtest completed", { runId: run.id, trades: trades.length });
    onProgress?.({ ...progress });
    return { runId: run.id, trades, logs };
  } catch (error) {
    progress.status = "failed";
    progress.endedAt = new Date().toISOString();
    progress.message = friendlyError(error);
    await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        endedAt: new Date(),
        errorMessage: friendlyError(error),
        logJson: JSON.stringify(logs)
      }
    });
    logLine(logs, "error", "Backtest failed", { error: friendlyError(error) });
    onProgress?.({ ...progress });
    throw error;
  }
}

function selectStocks(stocks: StockUniverseItem[], options: BacktestOptions): StockUniverseItem[] {
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

async function backtestSymbol(
  stock: StockUniverseItem,
  settings: BacktestSettings,
  provider: YahooFinanceProvider,
  fetchStart: Date,
  dailyStart: Date,
  endDate: Date,
  signalStart: Date,
  logs: ProviderLog[]
): Promise<{ trades: BacktestTradeResult[]; missingReason?: string }> {
  const [intraday, daily] = await Promise.all([
    getCachedCandles(provider, stock.yahooSymbol, "15m", fetchStart, endDate),
    getCachedCandles(provider, stock.yahooSymbol, "1d", dailyStart, endDate)
  ]);

  [...intraday.warnings, ...daily.warnings].forEach((warning) => logLine(logs, "warn", `${stock.symbol}: ${warning}`));

  const candles = intraday.candles
    .filter((candle) => candle.isComplete)
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  if (candles[0] && candles[0].time > signalStart) {
    return {
      trades: [],
      missingReason: "Yahoo intraday history did not reach the requested start date."
    };
  }
  if (candles.length < 220) {
    return { trades: [], missingReason: `Only ${candles.length} completed 15-minute candles available.` };
  }
  if (daily.candles.length < 2) {
    return { trades: [], missingReason: "Daily candles unavailable for previous-day pivots." };
  }

  const trades: BacktestTradeResult[] = [];
  let activeUntilIndex = -1;

  for (let index = 0; index < candles.length - 1; index += 1) {
    const signalCandle = candles[index];
    if (signalCandle.time < signalStart || signalCandle.time > endDate) continue;
    if (!settings.allowOverlap && index <= activeUntilIndex) continue;

    const evaluation = evaluateStrategy({
      stock,
      candles,
      dailyCandles: daily.candles,
      settings,
      evaluationIndex: index
    });

    if (evaluation.category !== "WATCH") continue;
    const entryCandle = candles[index + 1];
    if (!entryCandle || entryCandle.time > endDate) continue;

    const entryPrice = entryCandle.open * (1 + settings.charges.slippagePct);
    const plan = calculateTradePlan(
      entryPrice,
      settings,
      [evaluation.breakoutLevel, evaluation.indicators.vwap, evaluation.indicators.ema20, evaluation.indicators.pivot],
      evaluation.breakoutLevel
    );
    if (!plan) continue;

    const exit = findExit(candles, index + 1, plan.target2, plan.stopLoss, settings);
    activeUntilIndex = exit.exitIndex;
    const charges = estimateCharges(entryPrice, exit.exitPrice, plan.quantity, settings.charges);
    const grossProfit = (exit.exitPrice - entryPrice) * plan.quantity;
    trades.push({
      symbol: stock.symbol,
      signalTime: signalCandle.time,
      entryTime: entryCandle.time,
      exitTime: candles[exit.exitIndex].time,
      entryPrice: roundMoney(entryPrice),
      exitPrice: roundMoney(exit.exitPrice),
      quantity: plan.quantity,
      target: plan.target2,
      stopLoss: plan.stopLoss,
      exitReason: exit.exitReason,
      grossProfit: roundMoney(grossProfit),
      charges,
      netProfit: roundMoney(grossProfit - charges),
      returnPct: roundMoney(((exit.exitPrice - entryPrice) / entryPrice) * 100),
      score: evaluation.score,
      breakoutType: evaluation.breakoutType,
      breakoutLevel: evaluation.breakoutLevel
    });
  }

  return { trades };
}

function findExit(
  candles: Candle[],
  entryIndex: number,
  target: number,
  stopLoss: number,
  settings: StrategySettings
): { exitIndex: number; exitPrice: number; exitReason: BacktestTradeResult["exitReason"] } {
  const maxIndex = Math.min(candles.length - 1, entryIndex + settings.maxHoldingCandles);
  for (let index = entryIndex; index <= maxIndex; index += 1) {
    const candle = candles[index];
    const stopTouched = candle.low <= stopLoss;
    const targetTouched = candle.high >= target;
    if (stopTouched && targetTouched) {
      return {
        exitIndex: index,
        exitPrice: stopLoss * (1 - settings.charges.slippagePct),
        exitReason: "STOP_LOSS"
      };
    }
    if (stopTouched) {
      return {
        exitIndex: index,
        exitPrice: stopLoss * (1 - settings.charges.slippagePct),
        exitReason: "STOP_LOSS"
      };
    }
    if (targetTouched) {
      return {
        exitIndex: index,
        exitPrice: target * (1 - settings.charges.slippagePct),
        exitReason: "TARGET"
      };
    }
    if (settings.squareOffTime && timeKey(candle.time) >= settings.squareOffTime) {
      return {
        exitIndex: index,
        exitPrice: candle.close * (1 - settings.charges.slippagePct),
        exitReason: "SQUARE_OFF"
      };
    }
  }

  if (maxIndex < candles.length - 1) {
    return {
      exitIndex: maxIndex,
      exitPrice: candles[maxIndex].close * (1 - settings.charges.slippagePct),
      exitReason: "TIME_EXIT"
    };
  }

  return {
    exitIndex: candles.length - 1,
    exitPrice: candles.at(-1)!.close * (1 - settings.charges.slippagePct),
    exitReason: "END_OF_DATA"
  };
}

function summarizeBacktest(
  trades: BacktestTradeResult[],
  symbolsRequested: number,
  symbolsTested: number,
  missingSymbols: string[]
) {
  const winningTrades = trades.filter((trade) => trade.netProfit > 0).length;
  const losingTrades = trades.filter((trade) => trade.netProfit <= 0).length;
  const grossProfit = roundMoney(trades.reduce((sum, trade) => sum + trade.grossProfit, 0));
  const totalCharges = roundMoney(trades.reduce((sum, trade) => sum + trade.charges, 0));
  const netProfit = roundMoney(trades.reduce((sum, trade) => sum + trade.netProfit, 0));
  const bestTrade = trades.length ? Math.max(...trades.map((trade) => trade.netProfit)) : 0;
  const worstTrade = trades.length ? Math.min(...trades.map((trade) => trade.netProfit)) : 0;
  const targetHitCount = trades.filter((trade) => trade.exitReason === "TARGET").length;
  const stopLossHitCount = trades.filter((trade) => trade.exitReason === "STOP_LOSS").length;
  const timeExitCount = trades.filter((trade) => ["TIME_EXIT", "SQUARE_OFF", "END_OF_DATA"].includes(trade.exitReason)).length;
  const equityCurve: Array<{ date: string; equity: number }> = [];
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  const monthly = new Map<string, number>();
  const symbols = new Map<string, { symbol: string; trades: number; netProfit: number; wins: number }>();

  trades
    .slice()
    .sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime())
    .forEach((trade) => {
      equity = roundMoney(equity + trade.netProfit);
      peak = Math.max(peak, equity);
      maxDrawdown = Math.min(maxDrawdown, equity - peak);
      equityCurve.push({ date: trade.exitTime.toISOString(), equity });

      if (trade.netProfit > 0) {
        currentWins += 1;
        currentLosses = 0;
      } else {
        currentLosses += 1;
        currentWins = 0;
      }
      consecutiveWins = Math.max(consecutiveWins, currentWins);
      consecutiveLosses = Math.max(consecutiveLosses, currentLosses);

      monthly.set(monthKey(trade.exitTime), roundMoney((monthly.get(monthKey(trade.exitTime)) ?? 0) + trade.netProfit));
      const symbol = symbols.get(trade.symbol) ?? { symbol: trade.symbol, trades: 0, netProfit: 0, wins: 0 };
      symbol.trades += 1;
      symbol.netProfit = roundMoney(symbol.netProfit + trade.netProfit);
      if (trade.netProfit > 0) symbol.wins += 1;
      symbols.set(trade.symbol, symbol);
    });

  const grossWinners = trades.filter((trade) => trade.netProfit > 0).reduce((sum, trade) => sum + trade.netProfit, 0);
  const grossLosers = Math.abs(trades.filter((trade) => trade.netProfit <= 0).reduce((sum, trade) => sum + trade.netProfit, 0));

  return {
    symbolsRequested,
    symbolsTested,
    missingSymbols,
    totalSignals: trades.length,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRate: trades.length ? roundMoney((winningTrades / trades.length) * 100) : 0,
    grossProfit,
    totalCharges,
    netProfit,
    averageProfit: trades.length ? roundMoney(netProfit / trades.length) : 0,
    averageReturn: trades.length ? roundMoney(trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length) : 0,
    bestTrade: roundMoney(bestTrade),
    worstTrade: roundMoney(worstTrade),
    consecutiveWins,
    consecutiveLosses,
    maxDrawdown: roundMoney(Math.abs(maxDrawdown)),
    profitFactor: grossLosers > 0 ? roundMoney(grossWinners / grossLosers) : grossWinners > 0 ? grossWinners : 0,
    targetHitCount,
    stopLossHitCount,
    timeExitCount,
    monthlyPerformance: Array.from(monthly.entries()).map(([month, profit]) => ({ month, profit })),
    symbolPerformance: Array.from(symbols.values()).map((symbol) => ({
      ...symbol,
      winRate: symbol.trades ? roundMoney((symbol.wins / symbol.trades) * 100) : 0
    })),
    equityCurve
  };
}
