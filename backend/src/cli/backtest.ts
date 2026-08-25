import { runBacktest } from "../services/backtest.js";
import { normalizeUniverseKey } from "../services/universe.js";

const args = new Map<string, string>();
process.argv.slice(2).forEach((arg, index, all) => {
  if (arg.startsWith("--")) args.set(arg.slice(2), all[index + 1] ?? "true");
});

const symbols = args.get("symbols")?.split(",").map((symbol) => symbol.trim()).filter(Boolean);
const limit = args.has("limit") ? Number(args.get("limit")) : undefined;

runBacktest(
  {
    symbols,
    limit,
    universe: normalizeUniverseKey(args.get("universe")),
    startDate: args.get("start"),
    endDate: args.get("end"),
    capitalPerTrade: args.has("capital") ? Number(args.get("capital")) : undefined,
    targetPct: args.has("target") ? Number(args.get("target")) / 100 : undefined,
    maxStopLossPct: args.has("max-stop") ? Number(args.get("max-stop")) / 100 : undefined,
    volumeRatioThreshold: args.has("volume-ratio") ? Number(args.get("volume-ratio")) : undefined
  },
  (progress) => console.log(progress.message)
)
  .then(({ runId, trades }) => {
    const net = trades.reduce((sum, trade) => sum + trade.netProfit, 0);
    console.log(`Backtest ${runId} completed. Trades=${trades.length}, net P&L=${net.toFixed(2)}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
