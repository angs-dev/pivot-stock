import cors from "cors";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appConfig, normalizeNumber } from "./config.js";
import { marketStatus, tradingDateFor } from "./dates.js";
import { prisma } from "./db.js";
import { friendlyError } from "./logger.js";
import { runBacktest, type BacktestProgress } from "./services/backtest.js";
import { dailyPaperPerformance, isSessionSettleable, settlePaperTrades } from "./services/paperTrading.js";
import { runScan, type ScanProgress } from "./services/scan.js";
import { getSavedStrategySettings, normalizeStrategySettings, saveStrategySettings } from "./services/settings.js";
import { loadStockUniverse, normalizeUniverseKey } from "./services/universe.js";
import { estimateCharges, roundMoney } from "./trade.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(dirname, "../frontend");

let scanProgress: ScanProgress = {
  status: "idle",
  total: 0,
  completed: 0,
  failed: 0,
  message: "No scan has run yet"
};
let scanRunning = false;

let backtestProgress: BacktestProgress = {
  status: "idle",
  total: 0,
  completed: 0,
  missing: 0,
  message: "No backtest has run yet"
};
let backtestRunning = false;
let settlementRunning = false;
let lastSettledDate: string | null = null;

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, provider: appConfig.providerName, delayed: appConfig.providerDelayed });
});

app.get("/api/status", async (_request, response) => {
  const lastCache = await prisma.marketDataCache.findFirst({ orderBy: { fetchedAt: "desc" } });
  response.json({
    market: marketStatus(),
    provider: appConfig.providerName,
    delayed: appConfig.providerDelayed,
    lastSuccessfulDataUpdate: lastCache?.fetchedAt ?? null,
    autoScanEnabled: appConfig.autoScanEnabled,
    autoPaperTradeEnabled: appConfig.autoPaperTradeEnabled
  });
});

app.get("/api/settings", async (_request, response) => {
  response.json(await getSavedStrategySettings());
});

app.put("/api/settings", async (request, response) => {
  try {
    response.json(await saveStrategySettings(request.body ?? {}));
  } catch (error) {
    response.status(400).json({ error: friendlyError(error) });
  }
});

app.get("/api/universe", async (request, response) => {
  try {
    const universe = await loadStockUniverse(normalizeUniverseKey(request.query.scope), request.query.refresh === "1");
    response.json(universe);
  } catch (error) {
    response.status(502).json({ error: friendlyError(error) });
  }
});

app.post("/api/scan", async (request, response) => {
  if (scanRunning) {
    response.status(409).json({ error: "A scan is already running.", progress: scanProgress });
    return;
  }
  scanRunning = true;
  scanProgress = {
    status: "running",
    total: 0,
    completed: 0,
    failed: 0,
    message: "Starting scan",
    startedAt: new Date().toISOString()
  };
  const settings = await readStrategyBody(request.body ?? {});
  runScan(settings, (progress) => {
    scanProgress = progress;
  })
    .catch((error) => {
      scanProgress = {
        ...scanProgress,
        status: "failed",
        endedAt: new Date().toISOString(),
        message: friendlyError(error)
      };
    })
    .finally(() => {
      scanRunning = false;
    });
  response.status(202).json({ message: "Scan started", progress: scanProgress });
});

app.get("/api/scan/progress", (_request, response) => {
  response.json(scanProgress);
});

app.get("/api/scan/latest", async (_request, response) => {
  const run = await latestScanRun();
  response.json(run);
});

app.get("/api/stocks/:symbol", async (request, response) => {
  const symbol = request.params.symbol.toUpperCase().replace(/\.NS$/, "");
  const result = await prisma.scanResult.findFirst({
    where: { stockSymbol: symbol },
    orderBy: { createdAt: "desc" },
    include: {
      conditions: { orderBy: { sortOrder: "asc" } },
      indicators: true
    }
  });
  const stock = await prisma.stock.findUnique({ where: { symbol } });
  const recentCandles = await prisma.candle.findMany({
    where: { symbol: stock?.yahooSymbol ?? `${symbol}.NS`, timeframe: "15m" },
    orderBy: { time: "desc" },
    take: 30
  });
  if (!result) {
    response.status(404).json({ error: "No scan calculation found for that symbol yet." });
    return;
  }
  response.json({
    result: serializeScanResult(result),
    recentCandles: recentCandles.reverse()
  });
});

app.get("/api/stocks/:symbol/rejections", async (request, response) => {
  const symbol = request.params.symbol.toUpperCase().replace(/\.NS$/, "");
  const result = await prisma.scanResult.findFirst({
    where: { stockSymbol: symbol },
    orderBy: { createdAt: "desc" },
    include: { conditions: { orderBy: { sortOrder: "asc" } } }
  });
  if (!result) {
    response.status(404).json({ error: "No scan result found." });
    return;
  }
  response.json({
    symbol,
    failed: result.conditions.filter((condition) => !condition.passed),
    pending: safeJson<string[]>(result.pendingJson, [])
  });
});

app.post("/api/backtest", async (request, response) => {
  if (backtestRunning) {
    response.status(409).json({ error: "A backtest is already running.", progress: backtestProgress });
    return;
  }
  backtestRunning = true;
  backtestProgress = {
    status: "running",
    total: 0,
    completed: 0,
    missing: 0,
    message: "Starting backtest",
    startedAt: new Date().toISOString()
  };
  const settings = await readBacktestBody(request.body ?? {});
  runBacktest(settings, (progress) => {
    backtestProgress = progress;
  })
    .catch((error) => {
      backtestProgress = {
        ...backtestProgress,
        status: "failed",
        endedAt: new Date().toISOString(),
        message: friendlyError(error)
      };
    })
    .finally(() => {
      backtestRunning = false;
    });
  response.status(202).json({ message: "Backtest started", progress: backtestProgress });
});

app.get("/api/backtest/progress", (_request, response) => {
  response.json(backtestProgress);
});

app.get("/api/backtest/latest", async (_request, response) => {
  const run = await prisma.backtestRun.findFirst({
    orderBy: { startedAt: "desc" },
    include: {
      trades: {
        orderBy: { exitTime: "desc" },
        take: 200
      }
    }
  });
  response.json(run ? serializeBacktestRun(run) : null);
});

app.get("/api/backtest/:id", async (request, response) => {
  const run = await prisma.backtestRun.findUnique({
    where: { id: Number(request.params.id) },
    include: { trades: { orderBy: { exitTime: "asc" } } }
  });
  if (!run) {
    response.status(404).json({ error: "Backtest not found." });
    return;
  }
  response.json(serializeBacktestRun(run));
});

app.post("/api/paper-trades", async (request, response) => {
  try {
    const scanResultId = Number(request.body.scanResultId);
    const result = await prisma.scanResult.findUnique({ where: { id: scanResultId } });
    if (!result || result.category !== "BUY" || !result.entry || !result.quantity || !result.target2 || !result.stopLoss) {
      response.status(400).json({ error: "Create paper trades only from complete BUY scan candidates." });
      return;
    }
    const entryTime = result.signalTime ?? new Date();
    const trade = await prisma.paperTrade.create({
      data: {
        symbol: result.stockSymbol,
        companyName: result.companyName,
        sector: result.sector,
        tradingDate: tradingDateFor(entryTime),
        source: "MANUAL",
        entryTime,
        entryPrice: result.entry,
        quantity: result.quantity,
        target: result.target2,
        stopLoss: result.stopLoss,
        signalScore: result.score,
        signalReasonsJson: result.reasonsJson
      }
    });
    response.status(201).json(trade);
  } catch (error) {
    response.status(400).json({ error: friendlyError(error) });
  }
});

app.get("/api/paper-trades", async (_request, response) => {
  const trades = await prisma.paperTrade.findMany({ orderBy: { createdAt: "desc" }, include: { exits: true } });
  response.json(trades.map(serializePaperTrade));
});

app.post("/api/paper-trades/:id/close", async (request, response) => {
  try {
    const id = Number(request.params.id);
    const trade = await prisma.paperTrade.findUnique({ where: { id } });
    if (!trade || trade.status !== "OPEN") {
      response.status(400).json({ error: "Open paper trade not found." });
      return;
    }
    const exitPrice = normalizeNumber(request.body.exitPrice, Number.NaN);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      response.status(400).json({ error: "Provide a valid exit price." });
      return;
    }
    const exitReason = String(request.body.exitReason || "MANUAL");
    const grossProfit = roundMoney((exitPrice - trade.entryPrice) * trade.quantity);
    const settings = await getSavedStrategySettings();
    const charges = estimateCharges(trade.entryPrice, exitPrice, trade.quantity, settings.charges);
    const netProfit = roundMoney(grossProfit - charges);
    await prisma.paperTradeExit.create({
      data: {
        paperTradeId: trade.id,
        exitPrice,
        exitTime: new Date(),
        exitReason,
        grossProfit,
        charges,
        netProfit
      }
    });
    const updated = await prisma.paperTrade.update({
      where: { id },
      data: {
        status: "CLOSED",
        exitPrice,
        exitTime: new Date(),
        exitReason,
        grossProfit,
        charges,
        netProfit
      },
      include: { exits: true }
    });
    response.json(serializePaperTrade(updated));
  } catch (error) {
    response.status(400).json({ error: friendlyError(error) });
  }
});

app.get("/api/paper-trades/daily", async (_request, response) => {
  try {
    response.json(await dailyPaperPerformance());
  } catch (error) {
    response.status(500).json({ error: friendlyError(error) });
  }
});

app.post("/api/paper-trades/settle", async (request, response) => {
  if (settlementRunning) {
    response.status(409).json({ error: "A settlement pass is already running." });
    return;
  }
  settlementRunning = true;
  try {
    const tradingDate = typeof request.body?.tradingDate === "string" ? request.body.tradingDate : undefined;
    response.json(await settlePaperTrades({ tradingDate }));
  } catch (error) {
    response.status(500).json({ error: friendlyError(error) });
  } finally {
    settlementRunning = false;
  }
});

app.get("/api/paper-trades/performance", async (_request, response) => {
  const settings = await getSavedStrategySettings();
  const trades = await prisma.paperTrade.findMany();
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const winning = closed.filter((trade) => (trade.netProfit ?? 0) > 0).length;
  const losing = closed.filter((trade) => (trade.netProfit ?? 0) <= 0).length;
  const gross = roundMoney(closed.reduce((sum, trade) => sum + (trade.grossProfit ?? 0), 0));
  const charges = roundMoney(closed.reduce((sum, trade) => sum + (trade.charges ?? 0), 0));
  const net = roundMoney(closed.reduce((sum, trade) => sum + (trade.netProfit ?? 0), 0));
  response.json({
    openTrades: trades.filter((trade) => trade.status === "OPEN").length,
    closedTrades: closed.length,
    winningTrades: winning,
    losingTrades: losing,
    grossPnL: gross,
    charges,
    netPnL: net,
    winRate: closed.length ? roundMoney((winning / closed.length) * 100) : 0,
    averageReturn: closed.length ? roundMoney((net / closed.length / settings.capitalPerTrade) * 100) : 0,
    maximumDrawdown: calculateDrawdown(closed.map((trade) => trade.netProfit ?? 0))
  });
});

app.get("/api/export/scan", async (request, response) => {
  const run = await latestScanRun();
  if (!run) {
    response.status(404).json({ error: "No scan results to export." });
    return;
  }
  if (request.query.format === "json") {
    response.json(run);
    return;
  }
  response.header("Content-Type", "text/csv");
  response.attachment(`scan-results-${run.id}.csv`);
  response.send(toCsv(run.results));
});

app.get("/api/export/backtest/:id/trades", async (request, response) => {
  const run = await prisma.backtestRun.findUnique({
    where: { id: Number(request.params.id) },
    include: { trades: { orderBy: { exitTime: "asc" } } }
  });
  if (!run) {
    response.status(404).json({ error: "Backtest not found." });
    return;
  }
  if (request.query.format === "json") {
    response.json(serializeBacktestRun(run));
    return;
  }
  response.header("Content-Type", "text/csv");
  response.attachment(`backtest-trades-${run.id}.csv`);
  response.send(toCsv(run.trades));
});

// Daily cycle: once the closing bell has passed, replay the session's completed
// candles and close every position the scanner opened during the day.
if (appConfig.autoPaperTradeEnabled) {
  setInterval(
    () => {
      const today = tradingDateFor(new Date());
      if (settlementRunning || lastSettledDate === today || !isSessionSettleable(today)) return;
      settlementRunning = true;
      settlePaperTrades()
        .then((summary) => {
          lastSettledDate = today;
          console.log(
            `Daily settlement for ${today}: ${summary.settled} closed, ` +
              `${summary.unresolved} unresolved, net ${summary.netProfit}`
          );
        })
        .catch((error) => console.error(`Daily settlement failed: ${friendlyError(error)}`))
        .finally(() => {
          settlementRunning = false;
        });
    },
    15 * 60_000
  );
}

// Rolling intraday filter: re-scan the universe on a fixed cadence while the
// market is open. A scan that overruns its slot is skipped, never queued.
if (appConfig.autoScanEnabled) {
  const intervalMs = Math.max(1, appConfig.autoScanIntervalMinutes) * 60_000;
  console.log(
    `Auto scan enabled: every ${appConfig.autoScanIntervalMinutes} minute(s) during NSE hours ` +
      `on the ${appConfig.autoScanUniverse} universe.`
  );
  setInterval(() => {
    if (scanRunning || !marketStatus().isOpen) return;
    scanRunning = true;
    getSavedStrategySettings()
      .then((settings) =>
        runScan({ ...settings, universe: appConfig.autoScanUniverse }, (progress) => {
          scanProgress = progress;
        })
      )
      .then((run) => {
        const buy = run.results.filter((result) => result.category === "BUY").length;
        const watch = run.results.filter((result) => result.category === "WATCH").length;
        console.log(`Auto scan #${run.runId} finished: ${buy} BUY, ${watch} WATCH.`);
      })
      .catch((error) => console.error(`Auto scan failed: ${friendlyError(error)}`))
      .finally(() => {
        scanRunning = false;
      });
  }, intervalMs);
}

app.use(express.static(frontendDist));
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(frontendDist, "index.html"));
});

app.listen(port, () => {
  console.log(`NSE scanner API listening on http://127.0.0.1:${port}`);
});

async function readStrategyBody(body: Record<string, unknown>) {
  const symbols =
    typeof body.symbols === "string" && body.symbols.trim()
      ? body.symbols
          .split(",")
          .map((symbol) => symbol.trim())
          .filter(Boolean)
      : Array.isArray(body.symbols)
        ? body.symbols.map(String)
        : undefined;
  const limitValue = normalizeNumber(body.limit, Number.NaN);
  return {
    ...normalizeStrategySettings(body, await getSavedStrategySettings()),
    symbols,
    limit: Number.isFinite(limitValue) ? limitValue : undefined,
    universe: normalizeUniverseKey(body.universe),
    persistResults: body.persistResults === false || body.persistResults === "false" ? false : undefined
  };
}

async function readBacktestBody(body: Record<string, unknown>) {
  const symbols =
    typeof body.symbols === "string" && body.symbols.trim()
      ? body.symbols
          .split(",")
          .map((symbol) => symbol.trim())
          .filter(Boolean)
      : Array.isArray(body.symbols)
        ? body.symbols.map(String)
        : undefined;
  const limitValue = normalizeNumber(body.limit, Number.NaN);
  return {
    ...(await readStrategyBody(body)),
    startDate: typeof body.startDate === "string" ? body.startDate : undefined,
    endDate: typeof body.endDate === "string" ? body.endDate : undefined,
    symbols,
    limit: Number.isFinite(limitValue) ? limitValue : undefined,
    universe: normalizeUniverseKey(body.universe)
  };
}

async function latestScanRun() {
  const run = await prisma.scanRun.findFirst({
    where: {
      status: "COMPLETED",
      results: {
        some: {}
      }
    },
    orderBy: { startedAt: "desc" },
    include: {
      results: {
        include: {
          conditions: { orderBy: { sortOrder: "asc" } }
        }
      }
    }
  });
  if (!run) return null;
  const results = run.results.map(serializeScanResult).sort((a, b) => {
    const rank = (category: string) => (category === "BUY" ? 0 : category === "WATCH" ? 1 : 2);
    return rank(a.category) - rank(b.category) || b.score - a.score || (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0);
  });
  return {
    ...run,
    logs: safeJson(run.logJson, []),
    results,
    topThree: results.filter((result) => result.category === "BUY").slice(0, 3)
  };
}

function serializeScanResult(result: any) {
  return {
    ...result,
    reasons: safeJson<string[]>(result.reasonsJson, []),
    pending: safeJson<string[]>(result.pendingJson, []),
    conditions: result.conditions ?? []
  };
}

function serializeBacktestRun(run: any) {
  return {
    ...run,
    missingSymbols: safeJson(run.missingSymbolsJson, []),
    monthlyPerformance: safeJson(run.monthlyPerformanceJson, []),
    symbolPerformance: safeJson(run.symbolPerformanceJson, []),
    equityCurve: safeJson(run.equityCurveJson, []),
    logs: safeJson(run.logJson, [])
  };
}

function serializePaperTrade(trade: any) {
  return {
    ...trade,
    signalReasons: safeJson(trade.signalReasonsJson, [])
  };
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const ignored = new Set(["conditions", "indicators", "reasonsJson", "pendingJson", "scanRun"]);
  const headers = Object.keys(rows[0]).filter((key) => !ignored.has(key));
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString() : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function calculateDrawdown(profits: number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  profits.forEach((profit) => {
    equity += profit;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity - peak);
  });
  return roundMoney(Math.abs(drawdown));
}
