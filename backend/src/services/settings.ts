import { defaultStrategySettings, mergeStrategySettings, normalizeNumber } from "../config.js";
import { prisma } from "../db.js";
import type { ChargeSettings, StrategySettings } from "../types.js";

const STRATEGY_SETTINGS_KEY = "strategySettings";

export async function getSavedStrategySettings(): Promise<StrategySettings> {
  const row = await prisma.appSetting.findUnique({
    where: {
      key: STRATEGY_SETTINGS_KEY
    }
  });
  if (!row) return defaultStrategySettings;

  try {
    return mergeStrategySettings(JSON.parse(row.value) as Partial<StrategySettings>);
  } catch {
    return defaultStrategySettings;
  }
}

export async function saveStrategySettings(input: Record<string, unknown>): Promise<StrategySettings> {
  const settings = normalizeStrategySettings(input);
  await prisma.appSetting.upsert({
    where: {
      key: STRATEGY_SETTINGS_KEY
    },
    update: {
      value: JSON.stringify(settings)
    },
    create: {
      key: STRATEGY_SETTINGS_KEY,
      value: JSON.stringify(settings)
    }
  });
  return settings;
}

export function normalizeStrategySettings(input: Record<string, unknown>, base = defaultStrategySettings): StrategySettings {
  const charges = normalizeCharges((input.charges ?? {}) as Record<string, unknown>, base.charges);
  return mergeStrategySettings({
    capitalPerTrade: positiveNumber(input.capitalPerTrade, base.capitalPerTrade),
    targetPct: positiveNumber(input.targetPct, base.targetPct),
    maxStopLossPct: positiveNumber(input.maxStopLossPct, base.maxStopLossPct),
    stopBufferPct: nonNegativeNumber(input.stopBufferPct, base.stopBufferPct),
    volumeRatioThreshold: positiveNumber(input.volumeRatioThreshold, base.volumeRatioThreshold),
    minimumScore: positiveNumber(input.minimumScore, base.minimumScore),
    minimumWatchPassCount: Math.max(1, Math.floor(positiveNumber(input.minimumWatchPassCount, base.minimumWatchPassCount))),
    maxBreakoutExtensionPct: positiveNumber(input.maxBreakoutExtensionPct, base.maxBreakoutExtensionPct),
    breakoutConfirmationTolerancePct: positiveNumber(
      input.breakoutConfirmationTolerancePct,
      base.breakoutConfirmationTolerancePct
    ),
    vwapClearancePct: nonNegativeNumber(input.vwapClearancePct, base.vwapClearancePct),
    minimumAverageVolume: nonNegativeNumber(input.minimumAverageVolume, base.minimumAverageVolume),
    maxHoldingCandles: Math.max(1, Math.floor(positiveNumber(input.maxHoldingCandles, base.maxHoldingCandles))),
    squareOffTime: typeof input.squareOffTime === "string" ? input.squareOffTime : base.squareOffTime,
    allowOverlap: typeof input.allowOverlap === "boolean" ? input.allowOverlap : base.allowOverlap,
    charges
  });
}

function normalizeCharges(input: Record<string, unknown>, base: ChargeSettings): ChargeSettings {
  return {
    brokeragePercent: nonNegativeNumber(input.brokeragePercent, base.brokeragePercent),
    brokerageCapPerOrder: nonNegativeNumber(input.brokerageCapPerOrder, base.brokerageCapPerOrder),
    sttBuyPercent: nonNegativeNumber(input.sttBuyPercent, base.sttBuyPercent),
    sttSellPercent: nonNegativeNumber(input.sttSellPercent, base.sttSellPercent),
    exchangeTxnPercent: nonNegativeNumber(input.exchangeTxnPercent, base.exchangeTxnPercent),
    gstPercent: nonNegativeNumber(input.gstPercent, base.gstPercent),
    sebiPercent: nonNegativeNumber(input.sebiPercent, base.sebiPercent),
    stampDutyBuyPercent: nonNegativeNumber(input.stampDutyBuyPercent, base.stampDutyBuyPercent),
    slippagePct: nonNegativeNumber(input.slippagePct, base.slippagePct)
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  return Math.max(0.000001, normalizeNumber(value, fallback));
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return Math.max(0, normalizeNumber(value, fallback));
}
