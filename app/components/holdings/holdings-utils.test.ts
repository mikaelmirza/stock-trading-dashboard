import { describe, expect, it } from "vitest";
import {
  canSubmitTrade,
  computeUnrealizedPnL,
  holdingsEmptyMessage,
  tradeRejectionMessage,
} from "./holdings-utils";

describe("computeUnrealizedPnL", () => {
  it("returns nulls when there is no live price", () => {
    expect(computeUnrealizedPnL({ symbol: "AAPL", quantity: 10, avgCostBasis: "100.00" }, null)).toEqual({
      marketValue: null,
      unrealizedPnL: null,
      unrealizedPnLPercent: null,
    });
  });

  it("computes a gain", () => {
    const result = computeUnrealizedPnL({ symbol: "AAPL", quantity: 10, avgCostBasis: "100.00" }, "120.00");
    expect(result.marketValue).toBe("1200.00");
    expect(result.unrealizedPnL).toBe("200.00");
    expect(result.unrealizedPnLPercent).toBe("20.00");
  });

  it("computes a loss", () => {
    const result = computeUnrealizedPnL({ symbol: "AAPL", quantity: 10, avgCostBasis: "100.00" }, "90.00");
    expect(result.unrealizedPnL).toBe("-100.00");
    expect(result.unrealizedPnLPercent).toBe("-10.00");
  });
});

describe("holdingsEmptyMessage", () => {
  it("shows a loading message while pending", () => {
    expect(holdingsEmptyMessage(0, true)).toBe("Loading holdings…");
  });

  it("shows an empty-state prompt for a user with no positions", () => {
    expect(holdingsEmptyMessage(0, false)).toBe(
      "You don't own any positions yet — place a trade to get started."
    );
  });

  it("shows nothing once holdings are loaded and present", () => {
    expect(holdingsEmptyMessage(3, false)).toBeNull();
  });
});

describe("canSubmitTrade", () => {
  it("accepts a valid whole-share quantity with a live price and no halt", () => {
    expect(canSubmitTrade({ quantity: "10", isHalted: false, hasPrice: true })).toBe(true);
  });

  it("rejects a halted symbol", () => {
    expect(canSubmitTrade({ quantity: "10", isHalted: true, hasPrice: true })).toBe(false);
  });

  it("rejects when there's no live price yet", () => {
    expect(canSubmitTrade({ quantity: "10", isHalted: false, hasPrice: false })).toBe(false);
  });

  it("rejects non-integer or non-positive quantities", () => {
    expect(canSubmitTrade({ quantity: "0", isHalted: false, hasPrice: true })).toBe(false);
    expect(canSubmitTrade({ quantity: "-1", isHalted: false, hasPrice: true })).toBe(false);
    expect(canSubmitTrade({ quantity: "1.5", isHalted: false, hasPrice: true })).toBe(false);
    expect(canSubmitTrade({ quantity: "", isHalted: false, hasPrice: true })).toBe(false);
  });
});

describe("tradeRejectionMessage", () => {
  it("maps each known server rejection reason to an actionable message", () => {
    expect(tradeRejectionMessage("insufficient_cash")).toMatch(/cash/i);
    expect(tradeRejectionMessage("insufficient_shares")).toMatch(/shares/i);
    expect(tradeRejectionMessage("symbol_halted")).toMatch(/halted/i);
    expect(tradeRejectionMessage("invalid_quantity")).toMatch(/quantity/i);
    expect(tradeRejectionMessage("market_data_unavailable")).toMatch(/price/i);
  });

  it("falls back to a generic message for an unknown reason", () => {
    expect(tradeRejectionMessage("something_else")).toBe("Trade could not be completed.");
  });
});
