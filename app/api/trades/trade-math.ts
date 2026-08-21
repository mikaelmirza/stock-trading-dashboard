import { Decimal } from "decimal.js";

export interface Position {
  quantity: number;
  avgCostBasis: string;
}

export interface TradeMathResult {
  quantity: number;
  avgCostBasis: string;
  realizedPnL?: string;
}

export function tradeCost(quantity: number, price: string): Decimal {
  return new Decimal(price).times(quantity);
}

// Weighted-average cost basis on a buy: blends the existing position's cost
// with the new shares at the trade price.
export function applyBuy(
  position: Position | null,
  quantity: number,
  price: string
): TradeMathResult {
  const prevQuantity = position?.quantity ?? 0;
  const prevCost = position ? new Decimal(position.avgCostBasis) : new Decimal(0);
  const newQuantity = prevQuantity + quantity;
  const totalCost = prevCost.times(prevQuantity).plus(tradeCost(quantity, price));
  return {
    quantity: newQuantity,
    avgCostBasis: totalCost.dividedBy(newQuantity).toFixed(4),
  };
}

// A sell never changes the average cost basis of the remaining shares
// (weighted-average convention) — only the quantity shrinks. Also reports
// realized P&L on the shares sold.
export function applySell(position: Position, quantity: number, price: string): TradeMathResult {
  const realizedPnL = new Decimal(price).minus(position.avgCostBasis).times(quantity);
  return {
    quantity: position.quantity - quantity,
    avgCostBasis: position.avgCostBasis,
    realizedPnL: realizedPnL.toFixed(4),
  };
}

export type TradeRejectionReason =
  | "insufficient_cash"
  | "insufficient_shares"
  | "symbol_halted"
  | "invalid_quantity"
  | "market_data_unavailable";

export interface ValidateTradeParams {
  side: "BUY" | "SELL";
  quantity: number;
  price: string;
  cashBalance: string;
  position: Position | null;
  isHalted: boolean;
  isMarketDataStale: boolean;
}

// Every rejection path the trade API can return (PLAN step 32) — pure and
// synchronous so it's exhaustively unit-testable without a DB, called by
// the route handler after it's fetched the inputs.
export function validateTrade(params: ValidateTradeParams): TradeRejectionReason | null {
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    return "invalid_quantity";
  }
  // Staleness/missing SymbolState is checked before halt: an unavailable
  // book means we can't even know whether it's halted, which is a more
  // fundamental rejection than a definitely-known halt.
  if (params.isMarketDataStale) {
    return "market_data_unavailable";
  }
  if (params.isHalted) {
    return "symbol_halted";
  }
  if (params.side === "BUY") {
    if (tradeCost(params.quantity, params.price).greaterThan(params.cashBalance)) {
      return "insufficient_cash";
    }
  } else {
    const owned = params.position?.quantity ?? 0;
    if (params.quantity > owned) {
      return "insufficient_shares";
    }
  }
  return null;
}
