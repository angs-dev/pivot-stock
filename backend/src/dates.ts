import { DateTime } from "luxon";
import { appConfig } from "./config.js";
import type { Timeframe } from "./types.js";

export const IST_ZONE = appConfig.timezone;

export function toIst(date: Date = new Date()): DateTime {
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone(IST_ZONE);
}

export function dateFromIstParts(date: string, time = "00:00"): Date {
  return DateTime.fromISO(`${date}T${time}`, { zone: IST_ZONE }).toUTC().toJSDate();
}

export function tradingDateFor(date: Date): string {
  return toIst(date).toISODate() ?? "";
}

export function isWeekendIst(date: Date = new Date()): boolean {
  const weekday = toIst(date).weekday;
  return weekday === 6 || weekday === 7;
}

export function isWithinNseHours(date: Date = new Date()): boolean {
  const ist = toIst(date);
  if (ist.weekday === 6 || ist.weekday === 7) return false;
  const minutes = ist.hour * 60 + ist.minute;
  const [openHour, openMinute] = appConfig.marketOpen.split(":").map(Number);
  const [closeHour, closeMinute] = appConfig.marketClose.split(":").map(Number);
  return minutes >= openHour * 60 + openMinute && minutes <= closeHour * 60 + closeMinute;
}

export function marketStatus(date: Date = new Date()) {
  const ist = toIst(date);
  const isWeekend = ist.weekday === 6 || ist.weekday === 7;
  const isOpen = isWithinNseHours(date);
  return {
    isOpen,
    isWeekend,
    istTime: ist.toFormat("yyyy-LL-dd HH:mm:ss 'IST'"),
    status: isWeekend ? "Weekend" : isOpen ? "Open" : "Closed"
  };
}

export function isValidIntradayCandleStart(date: Date, timeframe: Timeframe): boolean {
  if (timeframe !== "15m") return true;
  const ist = toIst(date);
  if (ist.weekday === 6 || ist.weekday === 7) return false;
  const startMinutes = ist.hour * 60 + ist.minute;
  const endMinutes = startMinutes + 15;
  const [openHour, openMinute] = appConfig.marketOpen.split(":").map(Number);
  const [closeHour, closeMinute] = appConfig.marketClose.split(":").map(Number);
  const open = openHour * 60 + openMinute;
  const close = closeHour * 60 + closeMinute;
  return startMinutes >= open && endMinutes <= close;
}

export function isCompletedCandle(date: Date, timeframe: Timeframe, now: Date = new Date()): boolean {
  if (timeframe === "1d") {
    const candleDay = tradingDateFor(date);
    const today = tradingDateFor(now);
    if (candleDay < today) return true;
    return !isWithinNseHours(now) && toIst(now).toFormat("HH:mm") >= appConfig.marketClose;
  }
  const end = DateTime.fromJSDate(date, { zone: "utc" }).plus({ minutes: 15 }).toJSDate();
  return end.getTime() <= now.getTime();
}

export function subtractDays(date: Date, days: number): Date {
  return DateTime.fromJSDate(date, { zone: "utc" }).minus({ days }).toJSDate();
}

export function monthKey(date: Date): string {
  return toIst(date).toFormat("yyyy-LL");
}

export function timeKey(date: Date): string {
  return toIst(date).toFormat("HH:mm");
}
