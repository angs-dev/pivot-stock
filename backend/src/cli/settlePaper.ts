import { dailyPaperPerformance, settlePaperTrades } from "../services/paperTrading.js";

const args = new Map<string, string>();
process.argv.slice(2).forEach((arg, index, all) => {
  if (arg.startsWith("--")) args.set(arg.slice(2), all[index + 1] ?? "true");
});

const tradingDate = args.get("date");

settlePaperTrades(tradingDate && tradingDate !== "true" ? { tradingDate } : {})
  .then(async (summary) => {
    console.log(
      `Settled ${summary.settled} paper trade${summary.settled === 1 ? "" : "s"}, ` +
        `net P&L ${summary.netProfit.toFixed(2)}. ` +
        `${summary.pendingSession} waiting for the session to close, ${summary.unresolved} unresolved.`
    );
    summary.trades.forEach((trade) => {
      console.log(`  ${trade.tradingDate} ${trade.symbol} ${trade.exitReason} @ ${trade.exitPrice} → ${trade.netProfit}`);
    });
    summary.notes.forEach((note) => console.warn(`  ! ${note}`));

    if (args.has("report")) {
      const daily = await dailyPaperPerformance();
      console.log("\nDay-wise paper performance:");
      daily.days.slice(0, 20).forEach((day) => {
        console.log(
          `  ${day.tradingDate}  trades=${day.trades} closed=${day.closedTrades} ` +
            `win=${day.winRate}% net=${day.netProfit} cum=${day.cumulativeNet}`
        );
      });
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
