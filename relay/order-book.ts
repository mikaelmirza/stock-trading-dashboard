import { Decimal } from "decimal.js";

export interface OrderBookLevel {
  price: string;
  size: number;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

const DEPTH_LEVELS = 5;
const SPREAD_BPS = 5; // half-spread at the touch, in basis points of price
const LEVEL_STEP_BPS = 10; // additional spacing per level moving away from the touch
const BASE_SIZE = 100;
const SIZE_GROWTH = 1.5; // depth grows moving away from the touch

// Derives a bid/ask ladder from the current price plus a simulated
// spread/depth curve — not independently random, so price and book always
// stay consistent with each other (SPEC §4). Index 0 on each side is the
// level closest to the touch (best bid / best ask).
export function deriveOrderBook(price: string | number): OrderBookData {
  const mid = new Decimal(price);
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (let level = 0; level < DEPTH_LEVELS; level++) {
    const bps = SPREAD_BPS + level * LEVEL_STEP_BPS;
    const offset = mid.times(bps).dividedBy(10000);
    const size = Math.round(BASE_SIZE * SIZE_GROWTH ** level);

    bids.push({ price: mid.minus(offset).toFixed(2), size });
    asks.push({ price: mid.plus(offset).toFixed(2), size });
  }

  return { bids, asks };
}
