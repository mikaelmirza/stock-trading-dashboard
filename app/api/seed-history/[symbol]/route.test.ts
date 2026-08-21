import { describe, expect, it } from "vitest";
import { GET } from "./route";

function params(symbol: string) {
  return { params: Promise.resolve({ symbol }) };
}

describe("GET /api/seed-history/[symbol]", () => {
  it("returns ascending-date OHLC rows for a seeded symbol", async () => {
    const res = await GET(new Request("http://localhost"), params("AAPL"));
    const rows = await res.json();
    expect(rows.length).toBeGreaterThan(0);
    const dates = rows.map((r: { date: string }) => new Date(r.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(rows[0]).toHaveProperty("open");
    expect(rows[0]).toHaveProperty("close");
  });

  it("returns an empty array for an unseeded symbol", async () => {
    const res = await GET(new Request("http://localhost"), params("NOTREAL"));
    expect(await res.json()).toEqual([]);
  });
});
