export type Timeframe = "15m" | "1d";
export type ResultCategory = "BUY" | "WATCH" | "REJECTED";
export type UniverseKey = "nifty200" | "nse-equity";

export interface StockUniverseItem {
  symbol: string;
  yahooSymbol: string;
  companyName: string;
  sector?: string | null;
  industry?: string | null;
}

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  time: Date;
  tradingDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  provider: string;
  isComplete: boolean;
}

export interface ChargeSettings {
  brokeragePercent: number;
  brokerageCapPerOrder: number;
  sttBuyPercent: number;
  sttSellPercent: number;
  exchangeTxnPercent: number;
  gstPercent: number;
  sebiPercent: number;
  stampDutyBuyPercent: number;
  slippagePct: number;
}

export interface StrategySettings {
  timeframe: "15m";
  capitalPerTrade: number;
  targetPct: number;
  maxStopLossPct: number;
  stopBufferPct: number;
  volumeRatioThreshold: number;
  minimumScore: number;
  minimumWatchPassCount: number;
  maxBreakoutExtensionPct: number;
  breakoutConfirmationTolerancePct: number;
  vwapClearancePct: number;
  minimumAverageVolume: number;
  maxHoldingCandles: number;
  squareOffTime?: string;
  allowOverlap: boolean;
  charges: ChargeSettings;
}

export interface AppConfig {
  timezone: string;
  marketOpen: string;
  marketClose: string;
  universeCsvUrl: string;
  nseEquityCsvUrl: string;
  providerName: string;
  providerDelayed: boolean;
  providerConcurrency: number;
  providerRetryCount: number;
  providerTimeoutMs: number;
  providerRateLimitMs: number;
  cacheDurationMinutes: number;
  dailyCacheDurationMinutes: number;
  scanLookbackDays: number;
  dailyLookbackDays: number;
  autoScanEnabled: boolean;
  strategy: StrategySettings;
}

export interface StrategyCondition {
  key: string;
  label: string;
  passed: boolean;
  message?: string;
  sortOrder: number;
}

export interface PivotLevels {
  previousHigh: number;
  previousLow: number;
  previousClose: number;
  pivot: number;
  r1: number;
  s1: number;
  r2: number;
  s2: number;
  r3: number;
  s3: number;
}

export interface TradePlan {
  entry: number;
  quantity: number;
  investment: number;
  target1: number;
  target2: number;
  stopLoss: number;
  profitTarget1Gross: number;
  profitTarget2Gross: number;
  maxLossGross: number;
  riskReward: number;
  distanceBreakout?: number;
  capitalUnused: number;
  estimatedCharges: number;
  netProfitTarget2: number;
}

export interface StrategyEvaluation {
  symbol: string;
  companyName: string;
  sector?: string | null;
  category: ResultCategory;
  score: number;
  failedCount: number;
  reasons: string[];
  pending: string[];
  conditions: StrategyCondition[];
  indicators: Record<string, number | null>;
  latestCandle?: Candle;
  previousCandle?: Candle;
  pivots?: PivotLevels;
  volumeRatio?: number;
  breakoutType?: "PREVIOUS_HIGH" | "R1";
  breakoutLevel?: number;
  signalTime?: Date;
  liquidity?: number;
  trade?: TradePlan;
}

export interface ProviderLog {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: unknown;
}

export interface BacktestSettings extends StrategySettings {
  startDate: string;
  endDate: string;
  symbols?: string[];
  limit?: number;
  universe?: UniverseKey;
}

export interface BacktestTradeResult {
  symbol: string;
  signalTime: Date;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  target: number;
  stopLoss: number;
  exitReason: "TARGET" | "STOP_LOSS" | "TIME_EXIT" | "SQUARE_OFF" | "END_OF_DATA";
  grossProfit: number;
  charges: number;
  netProfit: number;
  returnPct: number;
  score: number;
  breakoutType?: string;
  breakoutLevel?: number;
}
