"use client";

import { useSyncExternalStore } from "react";
import type { MarketStreamClient, OrderBookData } from "@/app/hooks/market-stream";
import { useDashboardStore } from "@/app/store/dashboard-store";

export interface MarketData {
  symbol: string | null;
  price: string | null;
  book: OrderBookData | null;
  isHalted: boolean;
}

const EMPTY = { price: null, book: null, isHalted: false } as const;

// Thin layer over useWebSocket's raw multiplexed stream (PLAN step 26a),
// filtered to store.selectedSymbol — the one place that exposes per-symbol
// isHalted, since that's only ever needed for whichever symbol is currently
// selected (not worth adding to the global store).
//
// client is an external, non-React-managed data source, so this reads it
// via useSyncExternalStore rather than useState+useEffect — getSnapshot
// always reflects the client's current state directly (no risk of a stale
// frame right after switching symbols), and the subscription itself is
// re-scoped to selectedSymbol automatically since it's part of the
// subscribe callback's closure.
export function useMarketData(client: MarketStreamClient): MarketData {
  const selectedSymbol = useDashboardStore((s) => s.selectedSymbol);

  const state = useSyncExternalStore(
    (onStoreChange) => {
      if (!selectedSymbol) return () => {};
      return client.onMessage((symbol) => {
        if (symbol === selectedSymbol) onStoreChange();
      });
    },
    () => (selectedSymbol ? client.getState(selectedSymbol) : EMPTY),
    // No live WS connection exists during SSR, so the server snapshot is
    // always EMPTY — the client re-hydrates with real data after mount.
    () => EMPTY
  );

  return { symbol: selectedSymbol, ...state };
}
