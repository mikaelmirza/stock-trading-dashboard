import { create } from "zustand";

export type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface DashboardState {
  selectedSymbol: string | null;
  selectedTimeframe: Timeframe;
  connectionStatus: ConnectionStatus;
  setSelectedSymbol: (symbol: string) => void;
  setSelectedTimeframe: (timeframe: Timeframe) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

const initialState = {
  selectedSymbol: null as string | null,
  selectedTimeframe: "1M" as Timeframe,
  connectionStatus: "connecting" as ConnectionStatus,
};

// Single source of truth for "what symbol am I looking at" (SPEC §8): only
// the watchlist writes selectedSymbol (row click), only the chart writes
// selectedTimeframe (zoom/brush) — every widget just reads.
export const useDashboardStore = create<DashboardState>((set) => ({
  ...initialState,
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setSelectedTimeframe: (timeframe) => set({ selectedTimeframe: timeframe }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));

// Zustand stores are module-level singletons — tests need an explicit reset
// between cases so one test's setSelectedSymbol() doesn't leak into the next.
export function resetDashboardStore(): void {
  useDashboardStore.setState(initialState);
}
