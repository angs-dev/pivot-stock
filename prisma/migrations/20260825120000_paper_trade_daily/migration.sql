-- Daily paper trading: day grouping, auto/manual provenance, and settlement bookkeeping.
ALTER TABLE "PaperTrade" ADD COLUMN "tradingDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PaperTrade" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "PaperTrade" ADD COLUMN "settledAt" DATETIME;
ALTER TABLE "PaperTrade" ADD COLUMN "settleNote" TEXT;

CREATE INDEX "PaperTrade_tradingDate_status_idx" ON "PaperTrade"("tradingDate", "status");
CREATE INDEX "PaperTrade_symbol_tradingDate_idx" ON "PaperTrade"("symbol", "tradingDate");

-- Backfill the trading date for rows created before this migration.
UPDATE "PaperTrade" SET "tradingDate" = date("entryTime", '+330 minutes') WHERE "tradingDate" = '';
