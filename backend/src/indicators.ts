import type { Candle, PivotLevels } from "./types.js";

export function ema(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return output;

  let seed = 0;
  for (let index = 0; index < period; index += 1) {
    seed += values[index] ?? 0;
  }

  let previous = seed / period;
  output[period - 1] = previous;
  const multiplier = 2 / (period + 1);

  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] - previous) * multiplier + previous;
    output[index] = previous;
  }

  return output;
}

export function sessionVwap(candles: Candle[]): Array<number | null> {
  const output: Array<number | null> = [];
  let currentDate = "";
  let cumulativePv = 0;
  let cumulativeVolume = 0;

  candles.forEach((candle) => {
    if (candle.tradingDate !== currentDate) {
      currentDate = candle.tradingDate;
      cumulativePv = 0;
      cumulativeVolume = 0;
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePv += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    output.push(cumulativeVolume > 0 ? cumulativePv / cumulativeVolume : null);
  });

  return output;
}

export function averagePreviousVolume(candles: Candle[], currentIndex: number, period = 20): number | null {
  if (currentIndex < period) return null;
  const sample = candles.slice(currentIndex - period, currentIndex);
  if (sample.length < period || sample.some((candle) => !Number.isFinite(candle.volume) || candle.volume <= 0)) {
    return null;
  }
  return sample.reduce((sum, candle) => sum + candle.volume, 0) / period;
}

export function pivotLevels(previousDay: Candle): PivotLevels {
  const pivot = (previousDay.high + previousDay.low + previousDay.close) / 3;
  return {
    previousHigh: previousDay.high,
    previousLow: previousDay.low,
    previousClose: previousDay.close,
    pivot,
    r1: 2 * pivot - previousDay.low,
    s1: 2 * pivot - previousDay.high,
    r2: pivot + (previousDay.high - previousDay.low),
    s2: pivot - (previousDay.high - previousDay.low),
    r3: previousDay.high + 2 * (pivot - previousDay.low),
    s3: previousDay.low - 2 * (previousDay.high - pivot)
  };
}

export function previousDailyCandle(dailyCandles: Candle[], tradingDate: string): Candle | undefined {
  return [...dailyCandles]
    .filter((candle) => candle.tradingDate < tradingDate && candle.isComplete)
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate))
    .at(-1);
}

/**
 * Wilder's ATR (Pine's `ta.atr`), seeded with an SMA of the first true ranges
 * and then smoothed with RMA. This is not the same as an SMA of true range.
 */
export function wilderAtr(candles: Candle[], period: number): Array<number | null> {
  const output: Array<number | null> = Array(candles.length).fill(null);
  if (period < 1 || candles.length < period) return output;

  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });

  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += trueRanges[index];
  let atr = seed / period;
  output[period - 1] = atr;

  for (let index = period; index < candles.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index]) / period;
    output[index] = atr;
  }

  return output;
}

export interface SuperTrendPoint {
  trend: 1 | -1;
  up: number;
  dn: number;
  value: number;
  flip: boolean;
}

/**
 * Port of the SFI CHARLIE / SuperTrend bands: `ohlc4 +/- multiplier * ATR`,
 * ratcheted so each band only moves in the trend's favour, flipping when a
 * close crosses the opposite band from the previous bar.
 */
export function superTrend(
  candles: Candle[],
  period = 10,
  multiplier = 1.7
): Array<SuperTrendPoint | null> {
  const atrSeries = wilderAtr(candles, period);
  const output: Array<SuperTrendPoint | null> = Array(candles.length).fill(null);
  let previousUp: number | null = null;
  let previousDn: number | null = null;
  let trend: 1 | -1 = 1;
  let started = false;

  candles.forEach((candle, index) => {
    const atr = atrSeries[index];
    if (atr === null || !Number.isFinite(atr)) return;

    const source = (candle.open + candle.high + candle.low + candle.close) / 4;
    let up = source - multiplier * atr;
    let dn = source + multiplier * atr;
    const up1 = previousUp ?? up;
    const dn1 = previousDn ?? dn;
    const previousClose = candles[index - 1]?.close;

    if (previousClose !== undefined && previousClose > up1) up = Math.max(up, up1);
    if (previousClose !== undefined && previousClose < dn1) dn = Math.min(dn, dn1);

    const priorTrend = trend;
    if (trend === -1 && candle.close > dn1) trend = 1;
    else if (trend === 1 && candle.close < up1) trend = -1;

    output[index] = {
      trend,
      up,
      dn,
      value: trend === 1 ? up : dn,
      flip: started && trend !== priorTrend
    };

    previousUp = up;
    previousDn = dn;
    started = true;
  });

  return output;
}
