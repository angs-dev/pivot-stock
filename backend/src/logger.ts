import type { ProviderLog } from "./types.js";

export function logLine(
  logs: ProviderLog[],
  level: ProviderLog["level"],
  message: string,
  meta?: unknown
) {
  const entry: ProviderLog = {
    at: new Date().toISOString(),
    level,
    message,
    meta
  };
  logs.push(entry);
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  writer(`[${entry.at}] ${level.toUpperCase()} ${message}`, meta ?? "");
}

export function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}
