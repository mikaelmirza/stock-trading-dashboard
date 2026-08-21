import { describe, expect, it } from "vitest";
import { chartOverlayMessage, mergeLiveTick, seedRowsToCandles, timeframeBarCount } from "./candle-utils";

describe("seedRowsToCandles", () => {
  it("maps ISO date + decimal-string OHLC rows to chart candles", () => {
    const candles = seedRowsToCandles([
      {
        date: "2026-07-16T00:00:00.000Z",
        open: "328.0050",
        high: "334.6800",
        low: "326.7900",
        close: "333.2600",
      },
    ]);

    expect(candles).toEqual([
      { time: "2026-07-16", open: 328.005, high: 334.68, low: 326.79, close: 333.26 },
    ]);
  });
});

describe("mergeLiveTick", () => {
  it("starts a fresh candle when there is no existing one", () => {
    expect(mergeLiveTick(undefined, "2026-07-17", 100)).toEqual({
      time: "2026-07-17",
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    });
  });

  it("starts a fresh candle on a new day, discarding the previous day's candle", () => {
    const yesterday = { time: "2026-07-16", open: 90, high: 95, low: 85, close: 92 };
    expect(mergeLiveTick(yesterday, "2026-07-17", 100)).toEqual({
      time: "2026-07-17",
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    });
  });

  it("extends high/low and moves close while preserving open for the same day", () => {
    const today = { time: "2026-07-17", open: 100, high: 105, low: 98, close: 102 };

    expect(mergeLiveTick(today, "2026-07-17", 110)).toEqual({
      time: "2026-07-17",
      open: 100,
      high: 110,
      low: 98,
      close: 110,
    });

    expect(mergeLiveTick(today, "2026-07-17", 90)).toEqual({
      time: "2026-07-17",
      open: 100,
      high: 105,
      low: 90,
      close: 90,
    });
  });
});

describe("timeframeBarCount", () => {
  it("returns the expected bar count for each known preset", () => {
    expect(timeframeBarCount("1D")).toBe(1);
    expect(timeframeBarCount("1W")).toBe(5);
    expect(timeframeBarCount("1M")).toBe(22);
    expect(timeframeBarCount("3M")).toBe(66);
    expect(timeframeBarCount("1Y")).toBe(252);
  });

  it("falls back to the 1M count for an unknown timeframe", () => {
    expect(timeframeBarCount("bogus")).toBe(22);
  });
});

describe("chartOverlayMessage", () => {
  it("prompts to select a symbol when none is selected", () => {
    expect(chartOverlayMessage(null, false)).toBe(
      "Select a symbol from your watchlist to see its chart."
    );
  });

  it("prompts to select a symbol even while a stale query is still marked loading", () => {
    expect(chartOverlayMessage(null, true)).toBe(
      "Select a symbol from your watchlist to see its chart."
    );
  });

  it("shows a loading message while history is fetching for a selected symbol", () => {
    expect(chartOverlayMessage("AAPL", true)).toBe("Loading price history…");
  });

  it("shows nothing once a symbol is selected and history has loaded", () => {
    expect(chartOverlayMessage("AAPL", false)).toBeNull();
  });
});
