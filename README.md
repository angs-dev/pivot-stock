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

`npm run db:setup` generates Prisma Client and applies the checked-in SQLite schema to `prisma/dev.db`.

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

Paper trades are local database records only. They do not connect to Groww, Dhan, Upstox, or any broker, and they cannot place live orders.

## Troubleshooting

- If the NSE universe download fails, run a scan again later. Once a valid list is cached, the app falls back to the cached list.
- If Yahoo says intraday data is unavailable, shorten the backtest date range to the recent 60-day window.
- If a scan returns no BUY candidates, inspect WATCH and REJECTED tabs; strict conditions are intentionally hard to pass.
- If the database is missing, run `npm run db:setup`.
- If port 4000 or 5173 is busy, change `PORT` in `.env` or the Vite port in `package.json`.
