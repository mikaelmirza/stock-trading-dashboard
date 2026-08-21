import { describe, expect, it } from "vitest";
import { applyBuy, applySell, tradeCost, validateTrade } from "./trade-math";

describe("tradeCost", () => {
  it("is decimal-exact", () => {
    expect(tradeCost(3, "19.99").toString()).toBe("59.97");
  });
});

describe("applyBuy", () => {
  it("starts a new position from nothing", () => {
    expect(applyBuy(null, 10, "100.00")).toEqual({ quantity: 10, avgCostBasis: "100.0000" });
  });

  it("blends into an existing position with a weighted average", () => {
    const result = applyBuy({ quantity: 10, avgCostBasis: "100.0000" }, 10, "120.00");
    expect(result.quantity).toBe(20);
    expect(result.avgCostBasis).toBe("110.0000");
  });

  it("produces exact results for float-unsafe prices", () => {
    const result = applyBuy({ quantity: 3, avgCostBasis: "10.10" }, 1, "0.20");
    // (10.10*3 + 0.20*1) / 4 = 30.5 / 4 = 7.625
    expect(result.avgCostBasis).toBe("7.6250");
  });
});

describe("applySell", () => {
  it("leaves avgCostBasis unchanged and reduces quantity", () => {
    const result = applySell({ quantity: 10, avgCostBasis: "100.0000" }, 4, "120.00");
    expect(result.quantity).toBe(6);
    expect(result.avgCostBasis).toBe("100.0000");
  });

  it("computes realized P&L on the shares sold", () => {
    const result = applySell({ quantity: 10, avgCostBasis: "100.0000" }, 4, "120.00");
    expect(result.realizedPnL).toBe("80.0000"); // (120-100)*4
  });

  it("computes negative realized P&L on a loss", () => {
    const result = applySell({ quantity: 10, avgCostBasis: "100.0000" }, 4, "90.00");
    expect(result.realizedPnL).toBe("-40.0000");
  });
});

describe("validateTrade", () => {
  const base = {
    side: "BUY" as const,
    quantity: 10,
    price: "100.00",
    cashBalance: "100000.0000",
    position: null,
    isHalted: false,
    isMarketDataStale: false,
  };

  it("accepts a valid buy", () => {
    expect(validateTrade(base)).toBeNull();
  });

  it("rejects a non-positive quantity", () => {
    expect(validateTrade({ ...base, quantity: 0 })).toBe("invalid_quantity");
    expect(validateTrade({ ...base, quantity: -5 })).toBe("invalid_quantity");
  });

  it("rejects a non-integer quantity", () => {
    expect(validateTrade({ ...base, quantity: 1.5 })).toBe("invalid_quantity");
  });

  it("rejects stale/missing market data before checking halt", () => {
    expect(validateTrade({ ...base, isMarketDataStale: true, isHalted: true })).toBe(
      "market_data_unavailable"
    );
  });

  it("rejects a halted symbol", () => {
    expect(validateTrade({ ...base, isHalted: true })).toBe("symbol_halted");
  });

  it("rejects a buy exceeding cash balance", () => {
    expect(validateTrade({ ...base, quantity: 2000, price: "100.00", cashBalance: "1000.00" })).toBe(
      "insufficient_cash"
    );
  });

  it("accepts a buy that exactly spends the full cash balance", () => {
    expect(validateTrade({ ...base, quantity: 10, price: "100.00", cashBalance: "1000.00" })).toBeNull();
  });

  it("rejects a sell exceeding owned shares", () => {
    expect(
      validateTrade({
        ...base,
        side: "SELL",
        quantity: 5,
        position: { quantity: 3, avgCostBasis: "50.00" },
      })
    ).toBe("insufficient_shares");
  });

  it("rejects a sell with no position at all", () => {
    expect(validateTrade({ ...base, side: "SELL", quantity: 1, position: null })).toBe(
      "insufficient_shares"
    );
  });

  it("accepts a sell of exactly the owned quantity", () => {
    expect(
      validateTrade({
        ...base,
        side: "SELL",
        quantity: 3,
        position: { quantity: 3, avgCostBasis: "50.00" },
      })
    ).toBeNull();
  });
});
