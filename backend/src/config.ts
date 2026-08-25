import dotenv from "dotenv";
import type { AppConfig, StrategySettings } from "./types.js";

dotenv.config();

const numberFromEnv = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolFromEnv = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export const defaultStrategySettings: StrategySettings = {
  timeframe: "15m",
  capitalPerTrade: 10_000,
  targetPct: 0.01,
  maxStopLossPct: 0.0075,
  stopBufferPct: 0.001,
  volumeRatioThreshold: 1.2,
  minimumScore: 65,
  minimumWatchPassCount: 12,
  maxBreakoutExtensionPct: 0.015,
  breakoutConfirmationTolerancePct: 0.003,
  vwapClearancePct: 0.001,
  minimumAverageVolume: 1,
  maxHoldingCandles: 16,
  superTrendPeriod: 10,
  superTrendMultiplier: 1.7,
  requireSuperTrend: true,
  requireDailySuperTrend: true,
  squareOffTime: "15:15",
  allowOverlap: false,
  charges: {
    brokeragePercent: 0.0003,
    brokerageCapPerOrder: 20,
    sttBuyPercent: 0,
    sttSellPercent: 0.00025,
    exchangeTxnPercent: 0.0000345,
    gstPercent: 0.18,
    sebiPercent: 0.000001,
    stampDutyBuyPercent: 0.00003,
    slippagePct: 0
  }
};

export const appConfig: AppConfig = {
  timezone: "Asia/Kolkata",
  marketOpen: "09:15",
  marketClose: "15:30",
  universeCsvUrl: "https://www.niftyindices.com/IndexConstituent/ind_nifty200list.csv",
  nseEquityCsvUrl: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
  providerName: "Yahoo Finance",
  providerDelayed: true,
  providerConcurrency: numberFromEnv("PROVIDER_CONCURRENCY", 12),
  providerRetryCount: numberFromEnv("PROVIDER_RETRY_COUNT", 1),
  providerTimeoutMs: numberFromEnv("PROVIDER_TIMEOUT_MS", 15_000),
  providerRateLimitMs: numberFromEnv("PROVIDER_RATE_LIMIT_MS", 0),
  cacheDurationMinutes: numberFromEnv("CACHE_DURATION_MINUTES", 10),
  dailyCacheDurationMinutes: numberFromEnv("DAILY_CACHE_DURATION_MINUTES", 1_440),
  scanLookbackDays: numberFromEnv("SCAN_LOOKBACK_DAYS", 25),
  dailyLookbackDays: numberFromEnv("DAILY_LOOKBACK_DAYS", 45),
  autoScanEnabled: boolFromEnv("AUTO_SCAN_ENABLED", false),
  autoScanIntervalMinutes: numberFromEnv("AUTO_SCAN_INTERVAL_MINUTES", 5),
  autoScanUniverse: process.env.AUTO_SCAN_UNIVERSE === "nse-equity" ? "nse-equity" : "nifty200",
  autoPaperTradeEnabled: boolFromEnv("AUTO_PAPER_TRADE_ENABLED", false),
  strategy: defaultStrategySettings
};

export function mergeStrategySettings(input: Partial<StrategySettings> = {}): StrategySettings {
  const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<StrategySettings>;
  return {
    ...defaultStrategySettings,
    ...defined,
    charges: {
      ...defaultStrategySettings.charges,
      ...(defined.charges ?? {})
    },
    timeframe: "15m"
  };
}

export function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
