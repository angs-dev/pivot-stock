import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StrategyEvaluation } from "../types.js";

type CliArgs = Map<string, string>;

const args = parseArgs(process.argv.slice(2));

setEnvFromArg(args, "concurrency", "PROVIDER_CONCURRENCY");
setEnvFromArg(args, "rate-limit-ms", "PROVIDER_RATE_LIMIT_MS");
setEnvFromArg(args, "timeout-ms", "PROVIDER_TIMEOUT_MS");
setEnvFromArg(args, "retry-count", "PROVIDER_RETRY_COUNT");
setEnvFromArg(args, "cache-minutes", "CACHE_DURATION_MINUTES");
setEnvFromArg(args, "daily-cache-minutes", "DAILY_CACHE_DURATION_MINUTES");
setEnvFromArg(args, "scan-lookback-days", "SCAN_LOOKBACK_DAYS");
setEnvFromArg(args, "daily-lookback-days", "DAILY_LOOKBACK_DAYS");

const [{ runScan }, { normalizeUniverseKey }] = await Promise.all([
  import("../services/scan.js"),
  import("../services/universe.js")
]);

const symbols = args.get("symbols")?.split(",").map((symbol) => symbol.trim()).filter(Boolean);
const limit = numberArg(args, "limit");
const persistResults = !(args.has("no-persist") || args.get("persist") === "false");
const universe = normalizeUniverseKey(args.get("universe"));

runScan(
  {
    symbols,
    limit,
    universe,
    persistResults,
    capitalPerTrade: numberArg(args, "capital"),
    targetPct: percentArg(args, "target"),
    maxStopLossPct: percentArg(args, "max-stop"),
    volumeRatioThreshold: numberArg(args, "volume-ratio")
  },
  (progress) => console.log(progress.message)
)
  .then(async ({ runId, results, logs }) => {
    const buy = results.filter((result) => result.category === "BUY").length;
    const watch = results.filter((result) => result.category === "WATCH").length;
    const rejected = results.length - buy - watch;
    console.log(`Scan ${runId} completed. BUY=${buy}, WATCH=${watch}, REJECTED=${rejected}, total=${results.length}`);
    if (args.has("out-dir")) {
      const outputDir = path.resolve(args.get("out-dir") || "scan-output");
      await writeScanArtifacts(outputDir, {
        runId,
        universe,
        results,
        logs,
        persistResults
      });
      console.log(`Scan artifacts written to ${outputDir}`);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });

function parseArgs(values: string[]): CliArgs {
  const parsed: CliArgs = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, "true");
    }
  }
  return parsed;
}

function setEnvFromArg(args: CliArgs, argName: string, envName: string) {
  const value = args.get(argName);
  if (value !== undefined) process.env[envName] = value;
}

function numberArg(args: CliArgs, name: string): number | undefined {
  if (!args.has(name)) return undefined;
  const value = Number(args.get(name));
  return Number.isFinite(value) ? value : undefined;
}

function percentArg(args: CliArgs, name: string): number | undefined {
  const value = numberArg(args, name);
  return value === undefined ? undefined : value / 100;
}

async function writeScanArtifacts(
  outputDir: string,
  scan: {
    runId: number;
    universe: string;
    results: StrategyEvaluation[];
    logs: unknown[];
    persistResults: boolean;
  }
) {
  await mkdir(outputDir, { recursive: true });
  const rows = scan.results.map(scanRow);
  const rankedRows = [...rows].sort((a, b) => b.score - a.score);
  const summary = {
    runId: scan.runId,
    universe: scan.universe,
    generatedAt: new Date().toISOString(),
    persistResults: scan.persistResults,
    total: rows.length,
    buy: rows.filter((row) => row.category === "BUY").length,
    watch: rows.filter((row) => row.category === "WATCH").length,
    rejected: rows.filter((row) => row.category === "REJECTED").length,
    topWatch: rankedRows.filter((row) => row.category === "WATCH").slice(0, 25),
    topBuy: rankedRows.filter((row) => row.category === "BUY").slice(0, 25),
    logs: scan.logs
  };
  await Promise.all([
    writeFile(path.join(outputDir, "scan-summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
    writeFile(path.join(outputDir, "scan-results.csv"), toCsv(rows))
  ]);
}

function scanRow(result: StrategyEvaluation) {
  return {
    symbol: result.symbol,
    companyName: result.companyName,
    sector: result.sector ?? "",
    category: result.category,
    score: result.score,
    failedCount: result.failedCount,
    close: value(result.indicators.close),
    vwap: value(result.indicators.vwap),
    ema20: value(result.indicators.ema20),
    pivot: value(result.indicators.pivot),
    volumeRatio: value(result.volumeRatio),
    breakoutType: result.breakoutType ?? "",
    breakoutLevel: value(result.breakoutLevel),
    signalTime: result.signalTime?.toISOString() ?? "",
    reasons: result.reasons.join(" | "),
    pending: result.pending.join(" | ")
  };
}

function toCsv(rows: Array<Record<string, string | number | null>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(","))
  ].join("\n");
}

function csvValue(input: string | number | null): string {
  if (input === null) return "";
  const value = String(input);
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function value(input: number | null | undefined): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}
