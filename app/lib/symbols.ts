// Curated universe (SPEC §4): the only symbols the app knows about — trades,
// watchlist adds, and the seed-history/market-data engine are all restricted
// to this list. Not stored in the DB (SPEC §7 has no "Symbol" table); a
// static list is simplest for a fixed, curated set of this size.
export const SYMBOLS = [
  "AAPL",
  "AMD",
  "AMZN",
  "BA",
  "CSCO",
  "DIS",
  "GOOGL",
  "INTC",
  "JPM",
  "KO",
  "META",
  "MSFT",
  "NFLX",
  "NVDA",
  "ORCL",
  "PFE",
  "TSLA",
  "V",
  "WMT",
  "XOM",
] as const;

export type Symbol = (typeof SYMBOLS)[number];

export function isCuratedSymbol(value: string): value is Symbol {
  return (SYMBOLS as readonly string[]).includes(value);
}

// A new guest gets a starter watchlist rather than an empty one (SPEC §6).
export const DEFAULT_WATCHLIST: readonly Symbol[] = [
  "AAPL",
  "AMZN",
  "GOOGL",
  "MSFT",
  "NVDA",
  "TSLA",
];
