export interface Candle {
  time: string; // "yyyy-mm-dd" business-day string (lightweight-charts' Time type)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SeedHistoryRow {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

// Seed rows come back as ISO datetime strings (midnight UTC) with
// Decimal-as-string money fields (PLAN §3); lightweight-charts wants a plain
// "yyyy-mm-dd" business-day string and plain numbers for its own rendering
// math. This is display-only — trade pricing stays Decimal end to end
// server-side (app/lib/decimal.ts), never derived from chart data.
export function seedRowsToCandles(rows: readonly SeedHistoryRow[]): Candle[] {
  return rows.map((row) => ({
    time: row.date.slice(0, 10),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
  }));
}

// Folds a live price tick into the current day's candle: the same day
// extends high/low and moves close while preserving that day's original
// open; a new day (or no candle yet) starts fresh from the single price.
export function mergeLiveTick(
  current: Candle | undefined,
  time: string,
  price: number
): Candle {
  if (!current || current.time !== time) {
    return { time, open: price, high: price, low: price, close: price };
  }
  return {
    time,
    open: current.open,
    high: Math.max(current.high, price),
    low: Math.min(current.low, price),
    close: price,
  };
}

// Approximate trading-day bar counts for each timeframe preset (SPEC §8: the
// chart's own zoom/view window, not a server-side query granularity — the
// underlying data is always the same daily bars).
const TIMEFRAME_BAR_COUNTS: Record<string, number> = {
  "1D": 1,
  "1W": 5,
  "1M": 22,
  "3M": 66,
  "1Y": 252,
};

export function timeframeBarCount(timeframe: string): number {
  return TIMEFRAME_BAR_COUNTS[timeframe] ?? TIMEFRAME_BAR_COUNTS["1M"];
}

// PLAN step 36: distinct empty/loading copy for the chart, kept separate
// from the order book's own (connection-driven) messaging so the two never
// get conflated — this one is purely about the history fetch (29), nothing
// to do with the WS connection.
export function chartOverlayMessage(
  symbol: string | null,
  isHistoryLoading: boolean
): string | null {
  if (symbol === null) return "Select a symbol from your watchlist to see its chart.";
  if (isHistoryLoading) return "Loading price history…";
  return null;
}
