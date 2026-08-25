import { averagePreviousVolume, ema, pivotLevels, previousDailyCandle, sessionVwap } from "./indicators.js";
import { calculateTradePlan } from "./trade.js";
import type {
  Candle,
  PivotLevels,
  ResultCategory,
  StockUniverseItem,
  StrategyCondition,
  StrategyEvaluation,
  StrategySettings
} from "./types.js";

interface BreakoutCandidate {
  type: "PREVIOUS_HIGH" | "R1";
  level: number;
  valid: boolean;
  closesAbove: boolean;
  distancePct: number;
  extended: boolean;
}

interface EvaluateInput {
  stock: StockUniverseItem;
  candles: Candle[];
  dailyCandles: Candle[];
  settings: StrategySettings;
  evaluationIndex?: number;
}

export function evaluateStrategy(input: EvaluateInput): StrategyEvaluation {
  const sortedCandles = [...input.candles].sort((a, b) => a.time.getTime() - b.time.getTime());
  const candles =
    input.evaluationIndex === undefined
      ? sortedCandles.filter((candle) => candle.isComplete)
      : sortedCandles.slice(0, input.evaluationIndex + 1).filter((candle) => candle.isComplete);

  const latest = candles.at(-1);
  const previous = candles.at(-2);
  if (!latest || !previous) {
    return emptyEvaluation(input.stock, "Not enough completed 15-minute candles were available.");
  }

  const closes = candles.map((candle) => candle.close);
  const ema20Series = ema(closes, 20);
  const ema200Series = ema(closes, 200);
  const vwapSeries = sessionVwap(candles);
  const currentIndex = candles.length - 1;
  const ema20 = ema20Series[currentIndex] ?? null;
  const ema200 = ema200Series[currentIndex] ?? null;
  const previousEma20 = ema20Series[currentIndex - 1] ?? null;
  const vwap = vwapSeries[currentIndex] ?? null;
  const previousVolumeAverage = averagePreviousVolume(candles, currentIndex, 20);
  const volumeRatio =
    previousVolumeAverage && previousVolumeAverage > 0 ? latest.volume / previousVolumeAverage : undefined;
  const daily = previousDailyCandle(input.dailyCandles, latest.tradingDate);
  const pivots = daily ? pivotLevels(daily) : undefined;
  const breakout = detectBreakout(latest, previous, pivots, input.settings);
  const currentDayOpenIndex = candles.findIndex((candle) => candle.tradingDate === latest.tradingDate);
  const currentDayOpen = currentDayOpenIndex >= 0 ? candles[currentDayOpenIndex].open : null;
  const dayOpenEma20 = currentDayOpenIndex >= 0 ? (ema20Series[currentDayOpenIndex] ?? null) : null;
  const positiveDayOpen = valueAbove(currentDayOpen, pivots?.previousClose);
  const dayOpenAbovePivot = valueAbove(currentDayOpen, pivots?.pivot);
  const dayOpenAboveEma20 = valueAbove(currentDayOpen, dayOpenEma20);
  const ema20AbovePivot = valueAbove(ema20, pivots?.pivot);
  const vwapAboveEma20 = valueAbove(vwap, ema20);
  const vwapPositiveMomentum = latest.isComplete && valueAboveByPct(latest.close, vwap, input.settings.vwapClearancePct);
  const score = calculateScore({
    closeAboveVwap: vwapPositiveMomentum,
    closeAboveEma20: valueAbove(latest.close, ema20),
    ema20AboveEma200: valueAbove(ema20, ema200),
    closeAboveEma200: valueAbove(latest.close, ema200),
    ema20AbovePivot,
    vwapAboveEma20,
    hasBreakout: Boolean(breakout?.valid),
    volumeConfirmed: typeof volumeRatio === "number" && volumeRatio >= input.settings.volumeRatioThreshold
  });

  const liquidity = previousVolumeAverage ?? 0;
  const conditions = buildConditions({
    latest,
    previous,
    vwap,
    ema20,
    previousEma20,
    ema200,
    volumeRatio,
    pivots,
    breakout,
    liquidity,
    currentDayOpen,
    dayOpenEma20,
    positiveDayOpen,
    dayOpenAbovePivot,
    dayOpenAboveEma20,
    vwapPositiveMomentum,
    ema20AbovePivot,
    vwapAboveEma20,
    settings: input.settings,
    candleCount: candles.length
  });
  const failedConditions = conditions.filter((condition) => !condition.passed);
  const failedCount = failedConditions.length;
  const passedCount = conditions.length - failedCount;
  const category: ResultCategory =
    failedCount === 0 ? "BUY" : passedCount >= input.settings.minimumWatchPassCount ? "WATCH" : "REJECTED";

  const reasons = positiveReasons(conditions, breakout);
  const pending = failedConditions.map((condition) => pendingMessage(condition.key, condition.label));
  const trade = calculateTradePlan(latest.close, input.settings, [breakout?.level, vwap, ema20, pivots?.pivot], breakout?.level);

  return {
    symbol: input.stock.symbol,
    companyName: input.stock.companyName,
    sector: input.stock.sector,
    category,
    score,
    failedCount,
    reasons,
    pending,
    conditions,
    indicators: {
      close: latest.close,
      vwap,
      ema20,
      ema200,
      previousHigh: pivots?.previousHigh ?? null,
      previousLow: pivots?.previousLow ?? null,
      previousClose: pivots?.previousClose ?? null,
      currentDayOpen,
      dayOpenEma20,
      pivot: pivots?.pivot ?? null,
      r1: pivots?.r1 ?? null,
      s1: pivots?.s1 ?? null,
      r2: pivots?.r2 ?? null,
      s2: pivots?.s2 ?? null,
      r3: pivots?.r3 ?? null,
      s3: pivots?.s3 ?? null,
      volumeRatio: volumeRatio ?? null,
      breakoutLevel: breakout?.level ?? null,
      liquidity
    },
    latestCandle: latest,
    previousCandle: previous,
    pivots,
    volumeRatio,
    breakoutType: breakout?.type,
    breakoutLevel: breakout?.level,
    signalTime: latest.time,
    liquidity,
    trade
  };
}

function emptyEvaluation(stock: StockUniverseItem, reason: string): StrategyEvaluation {
  const conditions: StrategyCondition[] = [
    {
      key: "requiredData",
      label: "Required candle and indicator data available",
      passed: false,
      message: reason,
      sortOrder: 1
    }
  ];
  return {
    symbol: stock.symbol,
    companyName: stock.companyName,
    sector: stock.sector,
    category: "REJECTED",
    score: 0,
    failedCount: 1,
    reasons: [],
    pending: [reason],
    conditions,
    indicators: {}
  };
}

function valueAbove(left: number | null | undefined, right: number | null | undefined): boolean {
  return typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right) && left > right;
}

function valueAboveByPct(left: number | null | undefined, right: number | null | undefined, clearancePct: number): boolean {
  return (
    typeof left === "number" &&
    typeof right === "number" &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    right > 0 &&
    left >= right * (1 + clearancePct)
  );
}

function detectBreakout(
  latest: Candle,
  previous: Candle,
  pivots: PivotLevels | undefined,
  settings: StrategySettings
): BreakoutCandidate | undefined {
  if (!pivots) return undefined;
  const candidates: BreakoutCandidate[] = [
    candidateFor("PREVIOUS_HIGH", pivots.previousHigh, latest, previous, settings),
    candidateFor("R1", pivots.r1, latest, previous, settings)
  ].filter((candidate) => candidate.level > 0);

  return candidates
    .filter((candidate) => candidate.valid)
    .sort((a, b) => {
      if (a.extended !== b.extended) return a.extended ? 1 : -1;
      const distance = a.distancePct - b.distancePct;
      if (distance !== 0) return distance;
      return a.type === "PREVIOUS_HIGH" ? -1 : 1;
    })[0];
}

function candidateFor(
  type: BreakoutCandidate["type"],
  level: number,
  latest: Candle,
  previous: Candle,
  settings: StrategySettings
): BreakoutCandidate {
  const closesAbove = latest.close > level;
  const crossed = previous.close <= level && closesAbove;
  const confirmingSecondCandle =
    previous.close > level && previous.close <= level * (1 + settings.breakoutConfirmationTolerancePct) && closesAbove;
  const distancePct = level > 0 ? (latest.close - level) / level : Number.POSITIVE_INFINITY;
  const extended = distancePct > settings.maxBreakoutExtensionPct;
  return {
    type,
    level,
    valid: closesAbove && (crossed || confirmingSecondCandle),
    closesAbove,
    distancePct,
    extended
  };
}

function calculateScore(parts: {
  closeAboveVwap: boolean;
  closeAboveEma20: boolean;
  closeAboveEma200: boolean;
  ema20AboveEma200: boolean;
  ema20AbovePivot: boolean;
  vwapAboveEma20: boolean;
  hasBreakout: boolean;
  volumeConfirmed: boolean;
}): number {
  return (
    (parts.closeAboveVwap ? 15 : 0) +
    (parts.closeAboveEma20 ? 10 : 0) +
    (parts.closeAboveEma200 ? 10 : 0) +
    (parts.ema20AboveEma200 ? 10 : 0) +
    (parts.ema20AbovePivot ? 10 : 0) +
    (parts.vwapAboveEma20 ? 10 : 0) +
    (parts.hasBreakout ? 20 : 0) +
    (parts.volumeConfirmed ? 15 : 0)
  );
}

function buildConditions(input: {
  latest: Candle;
  previous: Candle;
  vwap: number | null;
  ema20: number | null;
  previousEma20: number | null;
  ema200: number | null;
  volumeRatio?: number;
  pivots?: PivotLevels;
  breakout?: BreakoutCandidate;
  liquidity: number;
  currentDayOpen: number | null;
  dayOpenEma20: number | null;
  positiveDayOpen: boolean;
  dayOpenAbovePivot: boolean;
  dayOpenAboveEma20: boolean;
  vwapPositiveMomentum: boolean;
  ema20AbovePivot: boolean;
  vwapAboveEma20: boolean;
  settings: StrategySettings;
  candleCount: number;
}): StrategyCondition[] {
  const { latest, previous, vwap, ema20, previousEma20, ema200, volumeRatio, pivots, breakout, settings } = input;
  const twoAboveEma20 = valueAbove(latest.close, ema20) && valueAbove(previous.close, previousEma20);
  const distancePct = breakout ? breakout.distancePct : undefined;
  const dataAvailable =
    input.candleCount >= 200 &&
    latest.isComplete &&
    Boolean(pivots) &&
    typeof input.currentDayOpen === "number" &&
    typeof input.dayOpenEma20 === "number" &&
    typeof vwap === "number" &&
    typeof ema20 === "number" &&
    typeof ema200 === "number" &&
    typeof volumeRatio === "number";

  const rows: Array<[string, string, boolean, string?]> = [
    ["latestCompleted", "Most recent 15-minute candle is completed", latest.isComplete],
    [
      "positiveDayOpen",
      "Current day open is above previous-day close",
      input.positiveDayOpen,
      "Current day open is not above previous-day close"
    ],
    ["dayOpenAbovePivot", "Current day open is above Pivot", input.dayOpenAbovePivot, "Current day open is not above Pivot"],
    [
      "dayOpenAboveEma20",
      "Current day open is above opening EMA 20",
      input.dayOpenAboveEma20,
      "Current day open is not above opening EMA 20"
    ],
    ["ema20AbovePivot", "EMA 20 is above Pivot", input.ema20AbovePivot, "EMA 20 is not above Pivot"],
    ["vwapAboveEma20", "VWAP is above EMA 20", input.vwapAboveEma20, "VWAP is not above EMA 20"],
    [
      "vwapPositiveMomentum",
      `Completed candle closes at least ${(settings.vwapClearancePct * 100).toFixed(2)}% above VWAP`,
      input.vwapPositiveMomentum,
      "Close is too close to VWAP"
    ],
    ["closeAboveEma20", "Close is above EMA 20", valueAbove(latest.close, ema20), "Price below EMA 20"],
    ["closeAboveEma200", "Close is above EMA 200", valueAbove(latest.close, ema200), "Price below EMA 200"],
    ["ema20AboveEma200", "EMA 20 is above EMA 200", valueAbove(ema20, ema200), "EMA 20 not yet above EMA 200"],
    ["twoAboveEma20", "Latest two completed candles close above EMA 20", twoAboveEma20, "Waiting for second candle above EMA 20"],
    ["breakoutValid", "Breakout above previous-day high or R1", Boolean(breakout?.valid), "Below previous-day high or R1"],
    [
      "latestAboveBreakout",
      "Latest candle closes above selected breakout level",
      Boolean(breakout?.closesAbove),
      "Below selected breakout level"
    ],
    [
      "volumeRatio",
      `Breakout volume ratio is at least ${settings.volumeRatioThreshold}`,
      typeof volumeRatio === "number" && volumeRatio >= settings.volumeRatioThreshold,
      "Waiting for volume confirmation"
    ],
    [
      "notExtended",
      "Signal is not excessively extended",
      !breakout || !breakout.extended,
      "Entry is excessively extended"
    ],
    [
      "withinExtensionLimit",
      `Close is within ${(settings.maxBreakoutExtensionPct * 100).toFixed(2)}% of breakout`,
      distancePct === undefined || distancePct <= settings.maxBreakoutExtensionPct,
      "Close is more than 1.5% above breakout"
    ],
    ["requiredData", "Required indicator and candle data are available", dataAvailable, "Required indicator data unavailable"],
    [
      "liquidity",
      "Liquidity and volume data are acceptable",
      input.liquidity >= settings.minimumAverageVolume && latest.volume > 0,
      "Invalid or insufficient volume data"
    ]
  ];

  return rows.map(([key, label, passed, message], index) => ({
    key,
    label,
    passed,
    message: passed ? undefined : message,
    sortOrder: index + 1
  }));
}

function positiveReasons(conditions: StrategyCondition[], breakout?: BreakoutCandidate): string[] {
  const labels = conditions
    .filter((condition) => condition.passed)
    .map((condition) => condition.label)
    .slice(0, 6);
  if (breakout) labels.push(`Breakout source: ${breakout.type === "R1" ? "Pivot R1" : "Previous-day high"}`);
  return labels;
}

function pendingMessage(key: string, fallback: string): string {
  const map: Record<string, string> = {
    positiveDayOpen: "Current day open is not above previous-day close",
    dayOpenAbovePivot: "Current day open is not above Pivot",
    dayOpenAboveEma20: "Current day open is not above opening EMA 20",
    ema20AbovePivot: "EMA 20 is not above Pivot",
    vwapAboveEma20: "VWAP is not above EMA 20",
    vwapPositiveMomentum: "Close is too close to VWAP",
    closeAboveVwap: "Price below VWAP",
    closeAboveEma20: "Price below EMA 20",
    closeAboveEma200: "Price below EMA 200",
    ema20AboveEma200: "EMA 20 not yet above EMA 200",
    twoAboveVwap: "Waiting for second candle above VWAP",
    twoAboveEma20: "Waiting for second candle above EMA 20",
    breakoutValid: "Below previous-day high or R1",
    latestAboveBreakout: "Below selected breakout level",
    volumeRatio: "Waiting for volume confirmation",
    notExtended: "Entry is excessively extended",
    withinExtensionLimit: "Close is more than 1.5% above breakout",
    liquidity: "Invalid or insufficient volume data"
  };
  return map[key] ?? fallback;
}
