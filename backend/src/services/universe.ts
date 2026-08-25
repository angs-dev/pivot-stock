import { parse } from "csv-parse/sync";
import { appConfig } from "../config.js";
import { prisma } from "../db.js";
import { friendlyError } from "../logger.js";
import type { StockUniverseItem, UniverseKey } from "../types.js";

type CsvRow = Record<string, string | undefined>;

type UniverseDefinition = {
  key: UniverseKey;
  label: string;
  url: string;
  minRows: number;
  parseRows: (rows: CsvRow[]) => StockUniverseItem[];
};

const UNIVERSE_KEYS: UniverseKey[] = ["nifty200", "nse-equity"];
const STOCK_WRITE_CHUNK_SIZE = 100;

const universeDefinitions: Record<UniverseKey, UniverseDefinition> = {
  nifty200: {
    key: "nifty200",
    label: "Nifty 200",
    url: appConfig.universeCsvUrl,
    minRows: 150,
    parseRows: parseNifty200Rows
  },
  "nse-equity": {
    key: "nse-equity",
    label: "NSE Equity List",
    url: appConfig.nseEquityCsvUrl,
    minRows: 1_000,
    parseRows: parseNseEquityRows
  }
};

export async function loadStockUniverse(
  universe: UniverseKey = "nifty200",
  forceRefresh = false
): Promise<{
  stocks: StockUniverseItem[];
  source: "downloaded" | "cache";
  universe: UniverseKey;
  label: string;
  warning?: string;
}> {
  const definition = universeDefinitions[universe];

  if (!forceRefresh) {
    const cached = await cachedStocks(universe);
    if (cached.length >= definition.minRows) {
      return { stocks: cached, source: "cache", universe, label: definition.label };
    }
  }

  try {
    const rows = await downloadCsv(definition);
    const stocks = definition.parseRows(rows);

    if (stocks.length < definition.minRows) {
      throw new Error(`Downloaded ${definition.label} universe looked incomplete: ${stocks.length} rows`);
    }

    await persistUniverse(stocks, universe);
    return { stocks, source: "downloaded", universe, label: definition.label };
  } catch (error) {
    const cached = await cachedStocks(universe);
    if (cached.length > 0) {
      return {
        stocks: cached,
        source: "cache",
        universe,
        label: definition.label,
        warning: `${definition.label} CSV failed; using the most recent cached universe. ${friendlyError(error)}`
      };
    }
    throw new Error(`Could not load ${definition.label} universe and no cache exists. ${friendlyError(error)}`);
  }
}

export async function loadNifty200Universe(forceRefresh = false) {
  return loadStockUniverse("nifty200", forceRefresh);
}

export function normalizeUniverseKey(value: unknown): UniverseKey {
  return value === "nse-equity" || value === "nse" ? "nse-equity" : "nifty200";
}

export async function cachedStocks(universe?: UniverseKey): Promise<StockUniverseItem[]> {
  const rows = await prisma.stock.findMany({
    orderBy: {
      symbol: "asc"
    }
  });
  return rows
    .filter((row) => !universe || sourceHasUniverse(row.source, universe))
    .map((row) => ({
      symbol: row.symbol,
      yahooSymbol: row.yahooSymbol,
      companyName: row.companyName,
      sector: row.sector,
      industry: row.industry
    }));
}

async function downloadCsv(definition: UniverseDefinition): Promise<CsvRow[]> {
  const response = await fetch(definition.url, {
    headers: {
      "user-agent": "Mozilla/5.0 Nifty200Scanner/1.0",
      accept: "text/csv,*/*"
    },
    signal: AbortSignal.timeout(appConfig.providerTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`${definition.label} CSV returned HTTP ${response.status}`);
  }
  return parse(await response.text(), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as CsvRow[];
}

function parseNifty200Rows(rows: CsvRow[]): StockUniverseItem[] {
  return dedupeStocks(
    rows
      .map((row) =>
        stockFromCsv({
          symbol: row.Symbol,
          companyName: row["Company Name"],
          sector: row.Industry,
          industry: row.Industry,
          series: row.Series
        })
      )
      .filter(isStock)
  );
}

function parseNseEquityRows(rows: CsvRow[]): StockUniverseItem[] {
  return dedupeStocks(
    rows
      .map((row) =>
        stockFromCsv({
          symbol: row.SYMBOL,
          companyName: row["NAME OF COMPANY"],
          series: row.SERIES
        })
      )
      .filter(isStock)
  );
}

function stockFromCsv(input: {
  symbol?: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  series?: string;
}): StockUniverseItem | null {
  if (input.series && input.series.trim().toUpperCase() !== "EQ") return null;
  const symbol = input.symbol?.trim().toUpperCase();
  const companyName = input.companyName?.trim();
  if (!symbol || !companyName) return null;
  return {
    symbol,
    yahooSymbol: `${symbol}.NS`,
    companyName,
    sector: input.sector?.trim() || null,
    industry: input.industry?.trim() || null
  };
}

function isStock(stock: StockUniverseItem | null): stock is StockUniverseItem {
  return Boolean(stock);
}

function dedupeStocks(stocks: StockUniverseItem[]): StockUniverseItem[] {
  const bySymbol = new Map<string, StockUniverseItem>();
  stocks.forEach((stock) => {
    if (!bySymbol.has(stock.symbol)) bySymbol.set(stock.symbol, stock);
  });
  return Array.from(bySymbol.values());
}

async function persistUniverse(stocks: StockUniverseItem[], universe: UniverseKey) {
  const existing = await prisma.stock.findMany({
    where: {
      symbol: {
        in: stocks.map((stock) => stock.symbol)
      }
    },
    select: {
      symbol: true,
      source: true
    }
  });
  const existingSources = new Map(existing.map((stock) => [stock.symbol, stock.source]));
  const lastUpdatedAt = new Date();
  const operations = stocks.map((stock) =>
    prisma.stock.upsert({
      where: { symbol: stock.symbol },
      update: {
        yahooSymbol: stock.yahooSymbol,
        companyName: stock.companyName,
        sector: stock.sector,
        industry: stock.industry,
        source: mergeUniverseSource(existingSources.get(stock.symbol), universe),
        lastUpdatedAt
      },
      create: {
        ...stock,
        source: universe,
        lastUpdatedAt
      }
    })
  );

  for (let index = 0; index < operations.length; index += STOCK_WRITE_CHUNK_SIZE) {
    await prisma.$transaction(operations.slice(index, index + STOCK_WRITE_CHUNK_SIZE));
  }
}

function mergeUniverseSource(source: string | undefined, universe: UniverseKey): string {
  const tags = new Set<UniverseKey>();
  UNIVERSE_KEYS.forEach((key) => {
    if (source && sourceHasUniverse(source, key)) tags.add(key);
  });
  tags.add(universe);
  return UNIVERSE_KEYS.filter((key) => tags.has(key)).join(",");
}

function sourceHasUniverse(source: string, universe: UniverseKey): boolean {
  const tags = source.split(/[|,]/).map((part) => part.trim());
  if (tags.includes(universe)) return true;
  if (universe === "nifty200" && source.includes("ind_nifty200list.csv")) return true;
  if (universe === "nse-equity" && source.includes("EQUITY_L.csv")) return true;
  return false;
}
