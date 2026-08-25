import { appConfig } from "../config.js";
import { dateFromIstParts, timeKey, toIst, tradingDateFor } from "../dates.js";
import { prisma } from "../db.js";
import { friendlyError, logLine } from "../logger.js";
import { getCachedCandles } from "../market/candleCache.js";
import { YahooFinanceProvider } from "../market/YahooFinanceProvider.js";
import { estimateCharges, roundMoney } from "../trade.js";
import type { Candle, ProviderLog, StrategyEvaluation, StrategySettings } from "../types.js";
import { getSavedStrategySettings } from "./settings.js";

export type PaperExitReason = "TARGET" | "STOP_LOSS" | "TIME_EXIT" | "SQUARE_OFF";

export interface AutoEntrySummary {
  created: number;
  skipped: number;
  symbols: string[];
}

export interface SettlementSummary {
  settled: number;
  unresolved: number;
  pendingSession: number;
  netProfit: number;
  trades: Array<{
    id: number;
    symbol: string;
    tradingDate: string;
    exitReason: PaperExitReason;
    exitPrice: number;
    netProfit: number;
  }>;
  notes: string[];
}

/**
 * Opens one auto paper trade per BUY candidate, deduplicated by symbol and
 * trading date so repeated scans through the day never stack positions.
 */
export async function openPaperTradesFromScan(
  results: StrategyEvaluation[],
  logs?: ProviderLog[]
): Promise<AutoEntrySummary> {
  const summary: AutoEntrySummary = { created: 0, skipped: 0, symbols: [] };
  const candidates = results.filter(
    (result) => result.category === "BUY" && result.trade && result.latestCandle && result.trade.quantity > 0
  );

  for (const result of candidates) {
    const trade = result.trade!;
    const tradingDate = result.latestCandle!.tradingDate;
    const existing = await prisma.paperTrade.findFirst({
      where: { symbol: result.symbol, tradingDate, source: "AUTO" }
    });
    if (existing) {
      summary.skipped += 1;
      continue;
    }

    await prisma.paperTrade.create({
      data: {
        symbol: result.symbol,
        companyName: result.companyName,
        sector: result.sector ?? null,
        tradingDate,
        source: "AUTO",
        entryTime: result.signalTime ?? result.latestCandle!.time,
        entryPrice: trade.entry,
        quantity: trade.quantity,
        target: trade.target2,
        stopLoss: trade.stopLoss,
        signalScore: result.score,
        signalReasonsJson: JSON.stringify(result.reasons)
      }
    });
    summary.created += 1;
    summary.symbols.push(result.symbol);
  }

  if (logs && (summary.created || summary.skipped)) {
    logLine(logs, "info", `Auto paper trades: ${summary.created} opened, ${summary.skipped} already open`, {
      symbols: summary.symbols
    });
  }
  return summary;
}

/**
 * A session can only be replayed once its candles are final: any past trading
 * date, or today once the closing bell has passed.
 */
export function isSessionSettleable(tradingDate: string, now: Date = new Date()): boolean {
  const today = tradingDateFor(now);
  if (tradingDate < today) return true;
  if (tradingDate > today) return false;
  return toIst(now).toFormat("HH:mm") >= appConfig.marketClose;
}

export async function settlePaperTrades(
  options: { tradingDate?: string } = {}
): Promise<SettlementSummary> {
  const settings = await getSavedStrategySettings();
  const provider = new YahooFinanceProvider();
  const summary: SettlementSummary = {
    settled: 0,
    unresolved: 0,
    pendingSession: 0,
    netProfit: 0,
    trades: [],
    notes: []
  };

  const open = await prisma.paperTrade.findMany({
    where: {
      status: "OPEN",
      ...(options.tradingDate ? { tradingDate: options.tradingDate } : {})
    },
    orderBy: [{ tradingDate: "asc" }, { entryTime: "asc" }]
  });

  const candlesByKey = new Map<string, Candle[]>();

  for (const trade of open) {
    const tradingDate = trade.tradingDate || tradingDateFor(trade.entryTime);
    if (!isSessionSettleable(tradingDate)) {
      summary.pendingSession += 1;
      continue;
    }

    try {
      const candles = await sessionCandles(provider, trade.symbol, tradingDate, candlesByKey);
      if (candles.length === 0) {
        await markUnresolved(trade.id, `No completed 15-minute candles available for ${tradingDate}.`);
        summary.unresolved += 1;
        summary.notes.push(`${trade.symbol}: no candles for ${tradingDate}`);
        continue;
      }

      const forward = candles.filter((candle) => candle.time.getTime() > trade.entryTime.getTime());
      if (forward.length === 0) {
        await markUnresolved(trade.id, `No candles after the entry candle on ${tradingDate}.`);
        summary.unresolved += 1;
        summary.notes.push(`${trade.symbol}: no post-entry candles on ${tradingDate}`);
        continue;
      }

      const exit = resolveExit(forward, trade.target, trade.stopLoss, settings);
      const closed = await closePaperTrade(trade.id, {
        entryPrice: trade.entryPrice,
        quantity: trade.quantity,
        exitPrice: exit.exitPrice,
        exitTime: exit.exitTime,
        exitReason: exit.exitReason,
        charges: settings.charges
      });

      summary.settled += 1;
      summary.netProfit = roundMoney(summary.netProfit + closed.netProfit);
      summary.trades.push({
        id: trade.id,
        symbol: trade.symbol,
        tradingDate,
        exitReason: exit.exitReason,
        exitPrice: closed.exitPrice,
        netProfit: closed.netProfit
      });
    } catch (error) {
      await markUnresolved(trade.id, friendlyError(error));
      summary.unresolved += 1;
      summary.notes.push(`${trade.symbol}: ${friendlyError(error)}`);
    }
  }

  return summary;
}

async function sessionCandles(
  provider: YahooFinanceProvider,
  symbol: string,
  tradingDate: string,
  cache: Map<string, Candle[]>
): Promise<Candle[]> {
  const key = `${symbol}:${tradingDate}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const stock = await prisma.stock.findUnique({ where: { symbol } });
  const yahooSymbol = stock?.yahooSymbol ?? `${symbol}.NS`;
  const start = dateFromIstParts(tradingDate, appConfig.marketOpen);
  const end = dateFromIstParts(tradingDate, appConfig.marketClose);
  const response = await getCachedCandles(provider, yahooSymbol, "15m", start, end);
  const candles = response.candles
    .filter((candle) => candle.isComplete && candle.tradingDate === tradingDate)
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  cache.set(key, candles);
  return candles;
}

/**
 * Mirrors the backtester's exit rules, including its conservative stop-first
 * handling when a single candle touches both the stop and the target.
 */
function resolveExit(
  candles: Candle[],
  target: number,
  stopLoss: number,
  settings: StrategySettings
): { exitPrice: number; exitTime: Date; exitReason: PaperExitReason } {
  const slippage = 1 - settings.charges.slippagePct;
  const maxIndex = Math.min(candles.length - 1, settings.maxHoldingCandles - 1);

  for (let index = 0; index <= maxIndex; index += 1) {
    const candle = candles[index];
    if (candle.low <= stopLoss) {
      return { exitPrice: roundMoney(stopLoss * slippage), exitTime: candle.time, exitReason: "STOP_LOSS" };
    }
    if (candle.high >= target) {
      return { exitPrice: roundMoney(target * slippage), exitTime: candle.time, exitReason: "TARGET" };
    }
    if (settings.squareOffTime && timeKey(candle.time) >= settings.squareOffTime) {
      return { exitPrice: roundMoney(candle.close * slippage), exitTime: candle.time, exitReason: "SQUARE_OFF" };
    }
  }

  const last = candles[maxIndex];
  return {
    exitPrice: roundMoney(last.close * slippage),
    exitTime: last.time,
    exitReason: maxIndex < candles.length - 1 ? "TIME_EXIT" : "SQUARE_OFF"
  };
}

async function closePaperTrade(
  id: number,
  input: {
    entryPrice: number;
    quantity: number;
    exitPrice: number;
    exitTime: Date;
    exitReason: PaperExitReason;
    charges: StrategySettings["charges"];
  }
) {
  const grossProfit = roundMoney((input.exitPrice - input.entryPrice) * input.quantity);
  const charges = estimateCharges(input.entryPrice, input.exitPrice, input.quantity, input.charges);
  const netProfit = roundMoney(grossProfit - charges);

  await prisma.paperTradeExit.create({
    data: {
      paperTradeId: id,
      exitPrice: input.exitPrice,
      exitTime: input.exitTime,
      exitReason: input.exitReason,
      grossProfit,
      charges,
      netProfit
    }
  });
  await prisma.paperTrade.update({
    where: { id },
    data: {
      status: "CLOSED",
      exitPrice: input.exitPrice,
      exitTime: input.exitTime,
      exitReason: input.exitReason,
      grossProfit,
      charges,
      netProfit,
      settledAt: new Date(),
      settleNote: null
    }
  });

  return { exitPrice: input.exitPrice, grossProfit, charges, netProfit };
}

async function markUnresolved(id: number, note: string) {
  await prisma.paperTrade.update({
    where: { id },
    data: { settledAt: new Date(), settleNote: note }
  });
}

export interface DailyPaperRow {
  tradingDate: string;
  trades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  charges: number;
  netProfit: number;
  bestTrade: number;
  worstTrade: number;
  targetHits: number;
  stopHits: number;
  timedExits: number;
  cumulativeNet: number;
}

export async function dailyPaperPerformance(): Promise<{
  days: DailyPaperRow[];
  totals: {
    days: number;
    trades: number;
    closedTrades: number;
    openTrades: number;
    netProfit: number;
    winRate: number;
    bestDay: number;
    worstDay: number;
  };
}> {
  const trades = await prisma.paperTrade.findMany({ orderBy: { entryTime: "asc" } });
  const byDate = new Map<string, DailyPaperRow>();

  trades.forEach((trade) => {
    const tradingDate = trade.tradingDate || tradingDateFor(trade.entryTime);
    const row =
      byDate.get(tradingDate) ??
      ({
        tradingDate,
        trades: 0,
        openTrades: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        grossProfit: 0,
        charges: 0,
        netProfit: 0,
        bestTrade: 0,
        worstTrade: 0,
        targetHits: 0,
        stopHits: 0,
        timedExits: 0,
        cumulativeNet: 0
      } satisfies DailyPaperRow);

    row.trades += 1;
    if (trade.status === "OPEN") {
      row.openTrades += 1;
    } else {
      const net = trade.netProfit ?? 0;
      row.closedTrades += 1;
      row.grossProfit = roundMoney(row.grossProfit + (trade.grossProfit ?? 0));
      row.charges = roundMoney(row.charges + (trade.charges ?? 0));
      row.netProfit = roundMoney(row.netProfit + net);
      if (net > 0) row.wins += 1;
      else row.losses += 1;
      row.bestTrade = row.closedTrades === 1 ? net : Math.max(row.bestTrade, net);
      row.worstTrade = row.closedTrades === 1 ? net : Math.min(row.worstTrade, net);
      if (trade.exitReason === "TARGET") row.targetHits += 1;
      else if (trade.exitReason === "STOP_LOSS") row.stopHits += 1;
      else row.timedExits += 1;
    }

    byDate.set(tradingDate, row);
  });

  const ascending = Array.from(byDate.values()).sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  let running = 0;
  ascending.forEach((row) => {
    row.winRate = row.closedTrades ? roundMoney((row.wins / row.closedTrades) * 100) : 0;
    row.bestTrade = roundMoney(row.bestTrade);
    row.worstTrade = roundMoney(row.worstTrade);
    running = roundMoney(running + row.netProfit);
    row.cumulativeNet = running;
  });

  const closedTrades = ascending.reduce((sum, row) => sum + row.closedTrades, 0);
  const wins = ascending.reduce((sum, row) => sum + row.wins, 0);

  return {
    days: [...ascending].reverse(),
    totals: {
      days: ascending.length,
      trades: trades.length,
      closedTrades,
      openTrades: ascending.reduce((sum, row) => sum + row.openTrades, 0),
      netProfit: running,
      winRate: closedTrades ? roundMoney((wins / closedTrades) * 100) : 0,
      bestDay: ascending.length ? roundMoney(Math.max(...ascending.map((row) => row.netProfit))) : 0,
      worstDay: ascending.length ? roundMoney(Math.min(...ascending.map((row) => row.netProfit))) : 0
    }
  };
}
