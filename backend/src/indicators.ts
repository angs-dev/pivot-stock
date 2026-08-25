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
