import YahooFinance from "yahoo-finance2";
import { appConfig } from "../config.js";
import { isCompletedCandle, isValidIntradayCandleStart, tradingDateFor } from "../dates.js";
import type { Candle, Timeframe } from "../types.js";
import type { MarketDataProvider } from "./MarketDataProvider.js";

type YahooQuote = {
  date?: Date | string | number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export class YahooFinanceProvider implements MarketDataProvider {
  name = appConfig.providerName;
  isDelayed = true;
  private client = new YahooFinance();
  private lastRequestAt = 0;

  async fetchHistoricalCandles(symbol: string, timeframe: Timeframe, start: Date, end: Date): Promise<Candle[]> {
    const interval = timeframe === "15m" ? "15m" : "1d";
    const quotes = await this.withRetry(async () => {
      await this.respectRateLimit();
      const result = await this.withTimeout(
        this.client.chart(symbol, {
          period1: start,
          period2: end,
          interval,
          includePrePost: false
        } as never),
        appConfig.providerTimeoutMs,
        `${symbol} ${timeframe}`
      );
      return ((result as { quotes?: YahooQuote[] }).quotes ?? []) as YahooQuote[];
    }, `${symbol} ${timeframe}`);

    const now = new Date();
    return quotes
      .map((quote) => this.quoteToCandle(symbol, timeframe, quote, now))
      .filter((candle): candle is Candle => Boolean(candle))
      .sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  private quoteToCandle(symbol: string, timeframe: Timeframe, quote: YahooQuote, now: Date): Candle | undefined {
    if (quote.date === undefined) return undefined;
    const time = new Date(quote.date);
    const { open, high, low, close, volume } = quote;
    if (!finiteNumber(open) || !finiteNumber(high) || !finiteNumber(low) || !finiteNumber(close) || !finiteNumber(volume)) {
      return undefined;
    }
    if (timeframe === "15m" && !isValidIntradayCandleStart(time, timeframe)) return undefined;

    return {
      symbol,
      timeframe,
      time,
      tradingDate: tradingDateFor(time),
      open,
      high,
      low,
      close,
      volume,
      provider: this.name,
      isComplete: isCompletedCandle(time, timeframe, now)
    };
  }

  private async withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= appConfig.providerRetryCount; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < appConfig.providerRetryCount) {
          await sleep(750 * (attempt + 1));
        }
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Yahoo Finance failed for ${label}: ${message}`);
  }

  private async respectRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < appConfig.providerRateLimitMs) {
      await sleep(appConfig.providerRateLimitMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`request timed out after ${ms}ms for ${label}`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
