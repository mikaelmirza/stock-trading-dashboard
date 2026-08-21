import { Decimal } from "decimal.js";

export interface HoldingRow {
  symbol: string;
  quantity: number;
  avgCostBasis: string;
}

export interface PnLResult {
  marketValue: string | null;
  unrealizedPnL: string | null;
  unrealizedPnLPercent: string | null;
}

// Live P&L is only computable for whichever symbol useMarketData is
// currently streaming (SPEC §8 keeps that to one selected symbol at a
// time) — other rows fall back to null P&L until selected, rather than a
// stale/wrong number.
export function computeUnrealizedPnL(holding: HoldingRow, livePrice: string | null): PnLResult {
  if (livePrice === null) {
    return { marketValue: null, unrealizedPnL: null, unrealizedPnLPercent: null };
  }
  const cost = new Decimal(holding.avgCostBasis).times(holding.quantity);
  const marketValue = new Decimal(livePrice).times(holding.quantity);
  const unrealizedPnL = marketValue.minus(cost);
  const unrealizedPnLPercent = cost.isZero() ? new Decimal(0) : unrealizedPnL.dividedBy(cost).times(100);

  return {
    marketValue: marketValue.toFixed(2),
    unrealizedPnL: unrealizedPnL.toFixed(2),
    unrealizedPnLPercent: unrealizedPnLPercent.toFixed(2),
  };
}

export function holdingsEmptyMessage(
  holdingsCount: number,
  isPending: boolean
): string | null {
  if (isPending) return "Loading holdings…";
  if (holdingsCount === 0) {
    return "You don't own any positions yet — place a trade to get started.";
  }
  return null;
}

// Client-side gate is UX only (SPEC §9) — every one of these is re-checked
// server-side in app/api/trades/route.ts regardless.
export function canSubmitTrade(params: {
  quantity: string;
  isHalted: boolean;
  hasPrice: boolean;
}): boolean {
  const quantity = Number(params.quantity);
  return Number.isInteger(quantity) && quantity > 0 && !params.isHalted && params.hasPrice;
}

const REJECTION_MESSAGES: Record<string, string> = {
  insufficient_cash: "Not enough cash for this trade.",
  insufficient_shares: "You don't own enough shares to sell that many.",
  symbol_halted: "Trading is halted for this symbol right now.",
  invalid_quantity: "Enter a valid whole-share quantity.",
  market_data_unavailable: "Live price unavailable — try again in a moment.",
};

// Surfaces the *server's* rejection reason in the UI (PLAN step 34) — never
// silently swallowed as a generic error, since each reason has a distinct,
// actionable message.
export function tradeRejectionMessage(reason: string): string {
  return REJECTION_MESSAGES[reason] ?? "Trade could not be completed.";
}
