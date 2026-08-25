import type { Candle, Timeframe } from "../types.js";

export interface CandleFetchResponse {
  candles: Candle[];
  warnings: string[];
  fetchedFromCache: boolean;
}

export interface MarketDataProvider {
  name: string;
  isDelayed: boolean;
  fetchHistoricalCandles(symbol: string, timeframe: Timeframe, start: Date, end: Date): Promise<Candle[]>;
}
