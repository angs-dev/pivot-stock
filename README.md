# NSE Pivot Scanner

Local NSE scanner, paper trader, and backtester for the Pivot + VWAP + EMA + volume strategy. It never connects to a broker and never places real orders.

## Requirements

- macOS
- Node.js 20 or newer, tested here with Node.js 22.14.0
- npm
- The built-in macOS `sqlite3` command

## Install

```bash
npm install
npm run db:setup
```

`npm run db:setup` generates Prisma Client and applies any pending checked-in migrations to `prisma/dev.db`. It tracks what it has already run, so it is safe to re-run after pulling schema changes.

## Start the Dashboard

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

For the compiled production app:

```bash
npm run build
npm run start
```

Production dashboard URL:

```text
http://127.0.0.1:4000
```

## Run a Manual Scan

From the dashboard, press **Run Scan Now**.

From the terminal:

```bash
npm run scan
```

For a small sample:

```bash
npm run scan -- --symbols RELIANCE,TCS,INFY
```

For a fast NSE cron-style scan that writes JSON and CSV artifacts without saving the full dashboard result table:

```bash
npm run scan:cron
```

## Run a Backtest

Use dates inside Yahoo Finance's recent intraday-data window.

```bash
npm run backtest -- --symbols RELIANCE,TCS --start 2026-08-01 --end 2026-08-23
```

The dashboard backtest form accepts comma-separated symbols. Leave symbols blank in API usage to test the selected universe.

## SuperTrend Filter

Every scan also evaluates a SuperTrend (the SFI CHARLIE / ATR-band indicator) and requires it to agree before a stock can reach BUY:

- `superTrendUp` - the intraday SuperTrend on 15-minute candles is in an uptrend.
- `dailySuperTrendUp` - the SuperTrend recomputed on completed daily candles agrees with it.

Bands are `ohlc4 +/- multiplier * ATR(period)` using Wilder's ATR, ratcheted so each band only moves in the trend's favour, flipping when a close crosses the opposite band from the previous bar. Defaults are period 10 and multiplier 1.7, tunable under **SuperTrend filter** in Strategy Settings, where each leg can also be switched off.

The daily leg reuses the daily candles already fetched for pivots, so it costs no extra provider requests. The **Trend** column in the results table shows both verdicts as a pair of arrows: intraday first, daily second.

Adding these two conditions takes the strict list from 18 to 20. `minimumWatchPassCount` is an absolute count, so leaving it at 12 makes WATCH slightly easier to reach than before; raise it to 13 or 14 to keep the old ratio.

## Rolling Intraday Scans

Set `AUTO_SCAN_ENABLED=true` to re-scan on a fixed cadence while NSE is open:

```bash
AUTO_SCAN_ENABLED=true
AUTO_SCAN_INTERVAL_MINUTES=5
AUTO_SCAN_UNIVERSE=nifty200
```

A scan still running when the next tick arrives is skipped rather than queued, and ticks outside market hours do nothing.

Cadence has to fit the universe. Measured on this machine with a warm cache, Nifty 200 takes roughly 30-50 seconds and fits comfortably inside five minutes; the full NSE list takes over three minutes warm and more than thirteen on a cold cache, so it cannot keep a five-minute schedule. Use `nifty200` for rolling scans and run the full list on demand.

## Daily Paper Trading

Paper trading can run as a full daily cycle. It stays local: no broker is contacted and no live order is ever placed.

Enable auto-entry in `.env`:

```bash
AUTO_PAPER_TRADE_ENABLED=true
```

With the flag on, every scan opens one paper trade per BUY candidate, deduplicated by symbol and trading date, so repeated scans through the day never stack positions on the same stock. Leave the flag off to keep creating paper trades by hand from the dashboard.

Positions are settled end-of-day: once the closing bell has passed, that session's completed 15-minute candles are replayed and each open position is closed with the same exit rules the backtester uses.

- Target touched, stop touched, or the `squareOffTime` candle reached
- If a single candle touches both target and stop, the stop wins, matching the backtester's conservative handling
- Positions still open after `maxHoldingCandles` exit at that candle's close

The running server settles automatically when `AUTO_PAPER_TRADE_ENABLED=true`. You can also settle on demand:

```bash
npm run paper:settle
```

For a specific session, plus a day-wise report:

```bash
npm run paper:settle -- --date 2026-08-21 --report
```

From the dashboard, press **Settle day** in the Paper Trading panel. Settlement is safe to repeat; positions whose session has not closed yet are left open, and a position whose candles are unavailable stays open with a note explaining why.

Day-wise performance is available at `http://127.0.0.1:4000/api/paper-trades/daily` and in the Paper Trading panel, showing per-session trade counts, target/stop/timed exit splits, win rate, net P&L, and a cumulative running total.

## Export Results

- Latest scan CSV: `http://127.0.0.1:4000/api/export/scan`
- Latest scan JSON: `http://127.0.0.1:4000/api/export/scan?format=json`
- Backtest trades CSV: `http://127.0.0.1:4000/api/export/backtest/:id/trades`
- Backtest trades JSON: `http://127.0.0.1:4000/api/export/backtest/:id/trades?format=json`

## GitHub Actions Cron

The workflow in `.github/workflows/nse-scan-cron.yml` runs the fast NSE scanner during NSE market hours, approximately 09:15-15:30 IST on weekdays. It also supports manual runs from the GitHub Actions tab.

Cron output is uploaded as an artifact:

- `scan-summary.json`
- `scan-results.csv`

Fast scan defaults are controlled by environment variables:

- `PROVIDER_CONCURRENCY=18`
- `PROVIDER_RATE_LIMIT_MS=0`
- `SCAN_LOOKBACK_DAYS=25`
- `DAILY_LOOKBACK_DAYS=45`
- `DAILY_CACHE_DURATION_MINUTES=1440`

## Free Web Hosting

GitHub Actions can run cron jobs, but it cannot host the Express dashboard 24/7. Use a free Node web-service host for the website.

### Render

This repo includes `render.yaml` for Render Blueprint deployment.

1. Push this project to GitHub.
2. Open Render and create a new Blueprint from the repo.
3. Render reads `render.yaml`, builds with `npm ci && npm run build`, and starts with `npm run start:deploy`.
4. Optional GitHub Actions deploy: create a Render deploy hook, then add it as the repository secret `RENDER_DEPLOY_HOOK_URL`.

Free Render services can sleep when idle, and the local SQLite file is best treated as temporary demo storage.

### Koyeb

Koyeb can deploy the same repo as a Node.js Git service.

- Build command: `npm ci && npm run build`
- Run command: `npm run start:deploy`
- Port: use the platform-provided `PORT`
- Environment: set `DATABASE_URL=file:./dev.db`

Like Render free hosting, use this as a demo/hobby deployment unless you move storage to a managed database.

## How the Calculations Work

- Universe can be the official NSE equity list (`https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv`) or the official Nifty 200 constituents CSV (`https://www.niftyindices.com/IndexConstituent/ind_nifty200list.csv`).
- Symbols map to Yahoo NSE symbols such as `RELIANCE.NS`.
- Only completed 15-minute candles inside NSE market hours are used.
- Timezone is `Asia/Kolkata`.
- VWAP resets for every trading session.
- EMA 20 and EMA 200 are calculated from 15-minute closes.
- Pivots use the previous completed daily candle.
- Volume ratio uses the current completed candle divided by the previous 20 completed 15-minute candles.
- BUY requires every strict condition to pass.
- WATCH requires score >= 65 and no more than two missing strict conditions.
- Backtests use the same strategy evaluator as scans, enter on the next candle open, and use conservative stop-first handling when target and stop are both touched in one candle.

## Free Data Limitations

Yahoo Finance data is free and delayed. It can be rate-limited, temporarily unavailable, or missing candles. Its 15-minute historical candles are usually limited to a recent window, roughly the last 60 days. The app does not invent missing prices, does not fill gaps with fake candles, and shows provider warnings when data is unavailable or suspicious, including zero-volume candles.

## Switching to Dhan or Upstox Later

Add a new class that implements `MarketDataProvider` in `backend/src/market/MarketDataProvider.ts`, then replace `YahooFinanceProvider` usage in the scanner/backtester services. Keep the returned candle shape identical so the strategy and backtest logic remain unchanged.

## Paper Trading Warning

Paper trades are local database records only. They do not connect to Groww, Dhan, Upstox, or any broker, and they cannot place live orders. This is true of automatic daily entries and end-of-day settlement as well: both only write rows to the local SQLite database.

## Troubleshooting

- If the NSE universe download fails, run a scan again later. Once a valid list is cached, the app falls back to the cached list.
- If Yahoo says intraday data is unavailable, shorten the backtest date range to the recent 60-day window.
- If a scan returns no BUY candidates, inspect WATCH and REJECTED tabs; strict conditions are intentionally hard to pass.
- If the database is missing, run `npm run db:setup`.
- If port 4000 or 5173 is busy, change `PORT` in `.env` or the Vite port in `package.json`.
