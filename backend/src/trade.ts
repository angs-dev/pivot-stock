import type { ChargeSettings, StrategySettings, TradePlan } from "./types.js";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function estimateCharges(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  charges: ChargeSettings
): number {
  const buyTurnover = entryPrice * quantity;
  const sellTurnover = exitPrice * quantity;
  const turnover = buyTurnover + sellTurnover;
  const buyBrokerage = Math.min(charges.brokerageCapPerOrder, buyTurnover * charges.brokeragePercent);
  const sellBrokerage = Math.min(charges.brokerageCapPerOrder, sellTurnover * charges.brokeragePercent);
  const brokerage = buyBrokerage + sellBrokerage;
  const stt = buyTurnover * charges.sttBuyPercent + sellTurnover * charges.sttSellPercent;
  const exchange = turnover * charges.exchangeTxnPercent;
  const sebi = turnover * charges.sebiPercent;
  const stamp = buyTurnover * charges.stampDutyBuyPercent;
  const gst = (brokerage + exchange) * charges.gstPercent;
  return roundMoney(brokerage + stt + exchange + sebi + stamp + gst);
}

export function calculateTradePlan(
  entry: number,
  settings: StrategySettings,
  supports: Array<number | null | undefined>,
  breakoutLevel?: number
): TradePlan | undefined {
  if (!Number.isFinite(entry) || entry <= 0) return undefined;

  const quantity = Math.floor(settings.capitalPerTrade / entry);
  if (quantity < 1) return undefined;

  const usableSupports = supports
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < entry)
    .sort((a, b) => b - a);

  const technicalStop = usableSupports[0] ? usableSupports[0] * (1 - settings.stopBufferPct) : undefined;
  const maxLossStop = entry * (1 - settings.maxStopLossPct);
  let stopLoss = technicalStop && technicalStop < entry ? Math.max(technicalStop, maxLossStop) : maxLossStop;
  if (stopLoss >= entry) stopLoss = maxLossStop;

  const target1 = entry * 1.005;
  const target2 = entry * (1 + settings.targetPct);
  const investment = entry * quantity;
  const profitTarget1Gross = (target1 - entry) * quantity;
  const profitTarget2Gross = (target2 - entry) * quantity;
  const maxLossGross = (entry - stopLoss) * quantity;
  const estimatedCharges = estimateCharges(entry, target2, quantity, settings.charges);
  const riskReward = maxLossGross > 0 ? profitTarget2Gross / maxLossGross : 0;

  return {
    entry: roundMoney(entry),
    quantity,
    investment: roundMoney(investment),
    target1: roundMoney(target1),
    target2: roundMoney(target2),
    stopLoss: roundMoney(stopLoss),
    profitTarget1Gross: roundMoney(profitTarget1Gross),
    profitTarget2Gross: roundMoney(profitTarget2Gross),
    maxLossGross: roundMoney(maxLossGross),
    riskReward: Math.round(riskReward * 100) / 100,
    distanceBreakout:
      breakoutLevel && breakoutLevel > 0 ? Math.round(((entry - breakoutLevel) / breakoutLevel) * 10_000) / 100 : undefined,
    capitalUnused: roundMoney(settings.capitalPerTrade - investment),
    estimatedCharges,
    netProfitTarget2: roundMoney(profitTarget2Gross - estimatedCharges)
  };
}
