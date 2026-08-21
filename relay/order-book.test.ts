import { describe, expect, it } from "vitest";
import { deriveOrderBook } from "./order-book";

describe("deriveOrderBook", () => {
  it("keeps bids strictly below and asks strictly above the input price", () => {
    const book = deriveOrderBook("100.00");
    for (const level of book.bids) {
      expect(Number(level.price)).toBeLessThan(100);
    }
    for (const level of book.asks) {
      expect(Number(level.price)).toBeGreaterThan(100);
    }
  });

  it("has a monotonic depth curve moving away from the touch", () => {
    const book = deriveOrderBook("100.00");
    for (let i = 1; i < book.bids.length; i++) {
      expect(Number(book.bids[i]!.price)).toBeLessThan(Number(book.bids[i - 1]!.price));
      expect(book.bids[i]!.size).toBeGreaterThan(book.bids[i - 1]!.size);
    }
    for (let i = 1; i < book.asks.length; i++) {
      expect(Number(book.asks[i]!.price)).toBeGreaterThan(Number(book.asks[i - 1]!.price));
      expect(book.asks[i]!.size).toBeGreaterThan(book.asks[i - 1]!.size);
    }
  });

  it("is a pure function of price — same input, same book", () => {
    expect(deriveOrderBook("250.50")).toEqual(deriveOrderBook("250.50"));
  });
});
