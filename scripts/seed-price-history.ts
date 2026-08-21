import "dotenv/config";
import { fileURLToPath } from "node:url";
import { db } from "../app/lib/db";
import { SYMBOLS } from "../app/lib/symbols";

const BASE_URL = "https://www.alphavantage.co/query";

export interface SeedRow {
  symbol: string;
  date: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: bigint;
}

interface AlphaVantageDailyResponse {
  "Time Series (Daily)"?: Record<
    string,
    {
      "1. open": string;
      "2. high": string;
      "3. low": string;
      "4. close": string;
      "5. volume": string;
    }
  >;
  Note?: string;
  Information?: string;
}

// Pure parsing, unit-testable without a real network call — the one thing
// worth isolating from the fetch/DB side effects below.
export function parseSeriesResponse(
  symbol: string,
  data: AlphaVantageDailyResponse
): SeedRow[] {
  const series = data["Time Series (Daily)"];
  if (!series) {
    const reason = data.Note ?? data.Information ?? JSON.stringify(data).slice(0, 200);
    throw new Error(`Alpha Vantage returned no time series for ${symbol}: ${reason}`);
  }
  return Object.entries(series).map(([date, values]) => ({
    symbol,
    date: new Date(`${date}T00:00:00.000Z`),
    open: values["1. open"],
    high: values["2. high"],
    low: values["3. low"],
    close: values["4. close"],
    volume: BigInt(values["5. volume"]),
  }));
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

async function fetchDailySeries(
  symbol: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<AlphaVantageDailyResponse> {
  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${apiKey}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage request failed for ${symbol}: ${res.status}`);
  }
  return (await res.json()) as AlphaVantageDailyResponse;
}

// Upsert on the (symbol, date) unique constraint — re-running the script is
// a no-op for unchanged rows, not a duplicate-insert error (PLAN step 13).
export async function seedRows(rows: readonly SeedRow[]): Promise<void> {
  for (const row of rows) {
    await db.seedPriceHistory.upsert({
      where: { symbol_date: { symbol: row.symbol, date: row.date } },
      create: row,
      update: row,
    });
  }
}

export async function seedSymbol(
  symbol: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<number> {
  const data = await fetchDailySeries(symbol, apiKey, fetchImpl);
  const rows = parseSeriesResponse(symbol, data);
  await seedRows(rows);
  return rows.length;
}

async function main() {
  const apiKey = process.env["ALPHA_VANTAGE_API_KEY"];
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY env var is required");
  }

  for (const symbol of SYMBOLS) {
    const count = await seedSymbol(symbol, apiKey, fetch);
    console.log(`${symbol}: seeded ${count} rows`);
    // Free tier is 25 requests/day (the real constraint), but a short delay
    // is cheap insurance against a plan with per-minute throttling too.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
