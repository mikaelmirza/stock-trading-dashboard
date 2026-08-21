import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

const TEST_SYMBOL = "TESTTRD";

function postReq(body: unknown) {
  return new Request("http://localhost/api/trades", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET/POST /api/trades", () => {
  let userId: string;

  afterEach(async () => {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.symbolState.deleteMany({ where: { symbol: TEST_SYMBOL } });
    cookieValue = undefined;
  });

  async function loginWithCash(cashBalance = "100000.0000") {
    const user = await db.user.create({
      data: { isGuest: true, lastActiveAt: new Date(), cashBalance },
    });
    userId = user.id;
    cookieValue = await encrypt({ userId });
    return user;
  }

  async function setSymbolState(price: string, isHalted = false, updatedSecondsAgo = 0) {
    await db.symbolState.upsert({
      where: { symbol: TEST_SYMBOL },
      create: { symbol: TEST_SYMBOL, lastPrice: price, isHalted },
      update: { lastPrice: price, isHalted },
    });
    if (updatedSecondsAgo > 0) {
      // Bypass @updatedAt's auto-now by writing raw SQL for the backdated timestamp.
      await db.$executeRawUnsafe(
        `UPDATE "SymbolState" SET "updatedAt" = now() - interval '${updatedSecondsAgo} seconds' WHERE symbol = $1`,
        TEST_SYMBOL
      );
    }
  }

  it("GET returns 401 with no session", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/trades"));
    expect(res.status).toBe(401);
  });

  it("POST rejects a buy when market data is missing entirely", async () => {
    await loginWithCash();
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "BUY", quantity: 10 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("market_data_unavailable");
  });

  it("POST rejects a trade against stale market data", async () => {
    await loginWithCash();
    await setSymbolState("100.00", false, 30); // 30s old, past the 10s threshold
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "BUY", quantity: 10 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("market_data_unavailable");
  });

  it("POST rejects a trade on a halted symbol", async () => {
    await loginWithCash();
    await setSymbolState("100.00", true);
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "BUY", quantity: 10 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("symbol_halted");
  });

  it("POST rejects a buy exceeding cash balance", async () => {
    await loginWithCash("500.0000");
    await setSymbolState("100.00");
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "BUY", quantity: 10 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("insufficient_cash");
  });

  it("POST rejects a sell exceeding owned shares", async () => {
    await loginWithCash();
    await setSymbolState("100.00");
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "SELL", quantity: 1 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("insufficient_shares");
  });

  it("POST rejects an invalid quantity", async () => {
    await loginWithCash();
    await setSymbolState("100.00");
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "BUY", quantity: -5 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_quantity");
  });

  it("POST executes a successful buy: exact cash/holding numbers", async () => {
    await loginWithCash("100000.0000");
    await setSymbolState("100.00");
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "BUY", quantity: 10 }));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.cashBalance).toBe("99000"); // 100000 - 10*100
    expect(body.holding.quantity).toBe(10);
    expect(body.holding.avgCostBasis.toString()).toBe("100");
    expect(body.trade.side).toBe("BUY");
    expect(body.trade.quantity).toBe(10);
  });

  it("POST executes a successful sell: exact cash/holding numbers and realized cost basis is unchanged", async () => {
    const user = await loginWithCash("100000.0000");
    await db.holding.create({
      data: { userId: user.id, symbol: TEST_SYMBOL, quantity: 10, avgCostBasis: "100.0000" },
    });
    await setSymbolState("120.00");

    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "SELL", quantity: 4 }));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.cashBalance).toBe("100480"); // 100000 + 4*120
    expect(body.holding.quantity).toBe(6);
    expect(body.holding.avgCostBasis.toString()).toBe("100"); // unchanged by a sell
  });

  it("POST fully selling a position deletes the Holding row and returns holding: null", async () => {
    const user = await loginWithCash();
    await db.holding.create({
      data: { userId: user.id, symbol: TEST_SYMBOL, quantity: 5, avgCostBasis: "100.0000" },
    });
    await setSymbolState("100.00");

    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: TEST_SYMBOL, side: "SELL", quantity: 5 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.holding).toBeNull();

    const remaining = await db.holding.findUnique({
      where: { userId_symbol: { userId: user.id, symbol: TEST_SYMBOL } },
    });
    expect(remaining).toBeNull();
  });

  it("GET filters by symbol when provided", async () => {
    await loginWithCash();
    await setSymbolState("100.00");
    const { POST, GET } = await import("./route");
    await POST(postReq({ symbol: TEST_SYMBOL, side: "BUY", quantity: 1 }));

    const res = await GET(new Request(`http://localhost/api/trades?symbol=${TEST_SYMBOL}`));
    const trades = await res.json();
    expect(trades.every((t: { symbol: string }) => t.symbol === TEST_SYMBOL)).toBe(true);
  });
});
