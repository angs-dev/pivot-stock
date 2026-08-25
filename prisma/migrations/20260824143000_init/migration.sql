-- CreateTable
CREATE TABLE "Stock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "yahooSymbol" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "sector" TEXT,
    "industry" TEXT,
    "source" TEXT NOT NULL,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Candle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "time" DATETIME NOT NULL,
    "tradingDate" TEXT NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "provider" TEXT NOT NULL,
    "isComplete" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketDataCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cacheKey" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rangeStart" DATETIME NOT NULL,
    "rangeEnd" DATETIME NOT NULL,
    "candleCount" INTEGER NOT NULL,
    "missingReason" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "settingsJson" TEXT NOT NULL,
    "totalStocks" INTEGER NOT NULL DEFAULT 0,
    "completedStocks" INTEGER NOT NULL DEFAULT 0,
    "failedStocks" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "errorMessage" TEXT,
    "logJson" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "ScanResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scanRunId" INTEGER NOT NULL,
    "stockSymbol" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "sector" TEXT,
    "category" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "close" REAL,
    "vwap" REAL,
    "ema20" REAL,
    "ema200" REAL,
    "previousHigh" REAL,
    "previousLow" REAL,
    "previousClose" REAL,
    "pivot" REAL,
    "r1" REAL,
    "s1" REAL,
    "r2" REAL,
    "s2" REAL,
    "r3" REAL,
    "s3" REAL,
    "volumeRatio" REAL,
    "breakoutLevel" REAL,
    "breakoutType" TEXT,
    "signalTime" DATETIME,
    "entry" REAL,
    "target1" REAL,
    "target2" REAL,
    "stopLoss" REAL,
    "quantity" INTEGER,
    "investment" REAL,
    "profitTarget1Gross" REAL,
    "profitTarget2Gross" REAL,
    "maxLossGross" REAL,
    "riskReward" REAL,
    "distanceBreakout" REAL,
    "capitalUnused" REAL,
    "estimatedCharges" REAL,
    "netProfitTarget2" REAL,
    "failedCount" INTEGER NOT NULL,
    "liquidity" REAL,
    "reasonsJson" TEXT NOT NULL DEFAULT '[]',
    "pendingJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanResult_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConditionResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scanResultId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "message" TEXT,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "ConditionResult_scanResultId_fkey" FOREIGN KEY ("scanResultId") REFERENCES "ScanResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IndicatorValue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scanResultId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" REAL,
    CONSTRAINT "IndicatorValue_scanResultId_fkey" FOREIGN KEY ("scanResultId") REFERENCES "ScanResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "tradingDate" TEXT NOT NULL,
    "breakoutType" TEXT NOT NULL,
    "breakoutLevel" REAL NOT NULL,
    "scanResultId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT,
    "sector" TEXT,
    "entryTime" DATETIME NOT NULL,
    "entryPrice" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "target" REAL NOT NULL,
    "stopLoss" REAL NOT NULL,
    "signalScore" INTEGER NOT NULL,
    "signalReasonsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "exitPrice" REAL,
    "exitTime" DATETIME,
    "exitReason" TEXT,
    "grossProfit" REAL,
    "charges" REAL,
    "netProfit" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PaperTradeExit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paperTradeId" INTEGER NOT NULL,
    "exitPrice" REAL NOT NULL,
    "exitTime" DATETIME NOT NULL,
    "exitReason" TEXT NOT NULL,
    "grossProfit" REAL NOT NULL,
    "charges" REAL NOT NULL,
    "netProfit" REAL NOT NULL,
    CONSTRAINT "PaperTradeExit_paperTradeId_fkey" FOREIGN KEY ("paperTradeId") REFERENCES "PaperTrade" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "settingsJson" TEXT NOT NULL,
    "symbolsRequested" INTEGER NOT NULL DEFAULT 0,
    "symbolsTested" INTEGER NOT NULL DEFAULT 0,
    "missingSymbolsJson" TEXT NOT NULL DEFAULT '[]',
    "totalSignals" INTEGER NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "winningTrades" INTEGER NOT NULL DEFAULT 0,
    "losingTrades" INTEGER NOT NULL DEFAULT 0,
    "winRate" REAL NOT NULL DEFAULT 0,
    "grossProfit" REAL NOT NULL DEFAULT 0,
    "totalCharges" REAL NOT NULL DEFAULT 0,
    "netProfit" REAL NOT NULL DEFAULT 0,
    "averageProfit" REAL NOT NULL DEFAULT 0,
    "averageReturn" REAL NOT NULL DEFAULT 0,
    "bestTrade" REAL NOT NULL DEFAULT 0,
    "worstTrade" REAL NOT NULL DEFAULT 0,
    "consecutiveWins" INTEGER NOT NULL DEFAULT 0,
    "consecutiveLosses" INTEGER NOT NULL DEFAULT 0,
    "maxDrawdown" REAL NOT NULL DEFAULT 0,
    "profitFactor" REAL NOT NULL DEFAULT 0,
    "targetHitCount" INTEGER NOT NULL DEFAULT 0,
    "stopLossHitCount" INTEGER NOT NULL DEFAULT 0,
    "timeExitCount" INTEGER NOT NULL DEFAULT 0,
    "monthlyPerformanceJson" TEXT NOT NULL DEFAULT '[]',
    "symbolPerformanceJson" TEXT NOT NULL DEFAULT '[]',
    "equityCurveJson" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "errorMessage" TEXT,
    "logJson" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "BacktestTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "backtestRunId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "signalTime" DATETIME NOT NULL,
    "entryTime" DATETIME NOT NULL,
    "exitTime" DATETIME NOT NULL,
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "target" REAL NOT NULL,
    "stopLoss" REAL NOT NULL,
    "exitReason" TEXT NOT NULL,
    "grossProfit" REAL NOT NULL,
    "charges" REAL NOT NULL,
    "netProfit" REAL NOT NULL,
    "returnPct" REAL NOT NULL,
    "score" INTEGER NOT NULL,
    "breakoutType" TEXT,
    "breakoutLevel" REAL,
    CONSTRAINT "BacktestTrade_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Stock_symbol_key" ON "Stock"("symbol");

-- CreateIndex
CREATE INDEX "Candle_symbol_timeframe_tradingDate_idx" ON "Candle"("symbol", "timeframe", "tradingDate");

-- CreateIndex
CREATE UNIQUE INDEX "Candle_symbol_timeframe_time_key" ON "Candle"("symbol", "timeframe", "time");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDataCache_cacheKey_key" ON "MarketDataCache"("cacheKey");

-- CreateIndex
CREATE INDEX "ScanResult_scanRunId_category_score_idx" ON "ScanResult"("scanRunId", "category", "score");

-- CreateIndex
CREATE INDEX "ScanResult_stockSymbol_idx" ON "ScanResult"("stockSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_symbol_tradingDate_breakoutType_key" ON "Signal"("symbol", "tradingDate", "breakoutType");
