import { appConfig } from "../config.js";
import { prisma } from "../db.js";
import { friendlyError } from "../logger.js";
import type { Candle, Timeframe } from "../types.js";
import type { CandleFetchResponse, MarketDataProvider } from "./MarketDataProvider.js";

const CANDLE_WRITE_CHUNK_SIZE = 75;

function cacheKey(provider: string, symbol: string, timeframe: Timeframe, start: Date, end: Date): string {
  return [provider, symbol, timeframe, start.toISOString(), end.toISOString()].join(":");
}

async function readCandles(symbol: string, timeframe: Timeframe, start: Date, end: Date): Promise<Candle[]> {
  const rows = await prisma.candle.findMany({
    where: {
      symbol,
      timeframe,
      time: {
        gte: start,
        lte: end
      }
    },
    orderBy: {
      time: "asc"
    }
  });

  return rows.map((row) => ({
    symbol: row.symbol,
    timeframe: row.timeframe as Timeframe,
    time: row.time,
    tradingDate: row.tradingDate,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    provider: row.provider,
    isComplete: row.isComplete
  }));
}

async function writeCandles(candles: Candle[]) {
  for (let index = 0; index < candles.length; index += CANDLE_WRITE_CHUNK_SIZE) {
    const chunk = candles.slice(index, index + CANDLE_WRITE_CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((candle) =>
        prisma.candle.upsert({
          where: {
            symbol_timeframe_time: {
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              time: candle.time
            }
          },
          update: {
            tradingDate: candle.tradingDate,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            provider: candle.provider,
            isComplete: candle.isComplete
          },
          create: candle
        })
      )
    );
  }
}

function cacheDurationMinutes(timeframe: Timeframe): number {
  return timeframe === "1d" ? appConfig.dailyCacheDurationMinutes : appConfig.cacheDurationMinutes;
}

function staleCutoff(timeframe: Timeframe): Date {
  return new Date(Date.now() - cacheDurationMinutes(timeframe) * 60_000);
}

function reusableEndCutoff(timeframe: Timeframe, end: Date): Date {
  return new Date(end.getTime() - cacheDurationMinutes(timeframe) * 60_000);
}

export async function getCachedCandles(
  provider: MarketDataProvider,
  symbol: string,
  timeframe: Timeframe,
  start: Date,
  end: Date
): Promise<CandleFetchResponse> {
  const key = cacheKey(provider.name, symbol, timeframe, start, end);
  const meta = await prisma.marketDataCache.findFirst({
    where: {
      provider: provider.name,
      symbol,
      timeframe,
      fetchedAt: {
        gte: staleCutoff(timeframe)
      },
      rangeStart: {
        lte: start
      },
      rangeEnd: {
        gte: reusableEndCutoff(timeframe, end)
      }
    },
    orderBy: {
      fetchedAt: "desc"
    }
  });

  if (meta) {
    const candles = await readCandles(symbol, timeframe, start, end);
    return {
      candles,
      warnings: meta.missingReason ? [meta.missingReason] : [],
      fetchedFromCache: true
    };
  }

  try {
    const candles = await provider.fetchHistoricalCandles(symbol, timeframe, start, end);
    await writeCandles(candles);
    const missingReason = detectMissingData(candles, timeframe);
    await prisma.marketDataCache.upsert({
      where: {
        cacheKey: key
      },
      update: {
        rangeStart: start,
        rangeEnd: end,
        candleCount: candles.length,
        missingReason,
        fetchedAt: new Date()
      },
      create: {
        cacheKey: key,
        symbol,
        timeframe,
        provider: provider.name,
        rangeStart: start,
        rangeEnd: end,
        candleCount: candles.length,
        missingReason
      }
    });
    return {
      candles,
      warnings: missingReason ? [missingReason] : [],
      fetchedFromCache: false
    };
  } catch (error) {
    const cached = await readCandles(symbol, timeframe, start, end);
    if (cached.length > 0) {
      return {
        candles: cached,
        warnings: [`Provider failed; using ${cached.length} cached ${timeframe} candles. ${friendlyError(error)}`],
        fetchedFromCache: true
      };
    }
    return {
      candles: [],
      warnings: [`Provider failed and no cached ${timeframe} candles are available. ${friendlyError(error)}`],
      fetchedFromCache: false
    };
  }
}

function detectMissingData(candles: Candle[], timeframe: Timeframe): string | undefined {
  if (candles.length === 0) return `No ${timeframe} candles returned by provider.`;
  if (timeframe === "15m") {
    const completed = candles.filter((candle) => candle.isComplete);
    if (completed.length < 220) {
      return `Only ${completed.length} completed 15-minute candles were available; EMA 200 may be unavailable.`;
    }
  }
  if (candles.some((candle) => candle.volume <= 0)) {
    return "One or more candles have invalid zero volume.";
  }
  return undefined;
}
