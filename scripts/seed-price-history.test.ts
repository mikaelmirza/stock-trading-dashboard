import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/app/lib/db";
import { parseSeriesResponse, seedRows, seedSymbol, type FetchLike } from "./seed-price-history";

describe("parseSeriesResponse", () => {
  it("maps the Alpha Vantage daily shape to seed rows", () => {
    const rows = parseSeriesResponse("AAPL", {
      "Time Series (Daily)": {
        "2026-07-17": {
          "1. open": "331.8100",
          "2. high": "334.9800",
          "3. low": "329.0006",
          "4. close": "333.7400",
          "5. volume": "63371173",
        },
      },
    });

    expect(rows).toEqual([
      {
        symbol: "AAPL",
        date: new Date("2026-07-17T00:00:00.000Z"),
        open: "331.8100",
        high: "334.9800",
        low: "329.0006",
        close: "333.7400",
        volume: BigInt(63371173),
      },
    ]);
  });

  it("throws with the API's own reason when the time series is missing", () => {
    expect(() =>
      parseSeriesResponse("AAPL", { Note: "rate limit exceeded" })
    ).toThrow(/rate limit exceeded/);
  });
});

describe("seedSymbol / seedRows", () => {
  afterEach(async () => {
    await db.seedPriceHistory.deleteMany({ where: { symbol: "TESTSYM" } });
  });

  it("fetches, parses, and upserts rows for a symbol", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        "Time Series (Daily)": {
          "2026-01-02": {
            "1. open": "10.00",
            "2. high": "11.00",
            "3. low": "9.50",
            "4. close": "10.50",
            "5. volume": "1000",
          },
        },
      }),
    });

    const count = await seedSymbol("TESTSYM", "fake-key", fetchImpl);
    expect(count).toBe(1);

    const row = await db.seedPriceHistory.findFirstOrThrow({ where: { symbol: "TESTSYM" } });
    expect(row.close.toString()).toBe("10.5");
  });

  it("re-running seedRows for the same (symbol, date) is a no-op upsert, not a duplicate", async () => {
    const row = {
      symbol: "TESTSYM",
      date: new Date("2026-01-02T00:00:00.000Z"),
      open: "10.00",
      high: "11.00",
      low: "9.50",
      close: "10.50",
      volume: BigInt(1000),
    };

    await seedRows([row]);
    await seedRows([{ ...row, close: "10.75" }]);

    const rows = await db.seedPriceHistory.findMany({ where: { symbol: "TESTSYM" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.close.toString()).toBe("10.75");
  });

  it("throws (rather than silently returning partial rows) when the API request fails", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    await expect(seedSymbol("TESTSYM", "fake-key", fetchImpl)).rejects.toThrow(/429/);
  });
});
