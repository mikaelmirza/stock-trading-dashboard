import { afterEach, describe, expect, it } from "vitest";
import { resetDashboardStore, useDashboardStore } from "./dashboard-store";

describe("useDashboardStore", () => {
  afterEach(() => {
    resetDashboardStore();
  });

  it("starts with no selected symbol and sensible defaults", () => {
    const state = useDashboardStore.getState();
    expect(state.selectedSymbol).toBeNull();
    expect(state.selectedTimeframe).toBe("1M");
    expect(state.connectionStatus).toBe("connecting");
  });

  it("setSelectedSymbol updates only selectedSymbol", () => {
    useDashboardStore.getState().setSelectedSymbol("AAPL");
    expect(useDashboardStore.getState().selectedSymbol).toBe("AAPL");
    expect(useDashboardStore.getState().selectedTimeframe).toBe("1M");
  });

  it("setSelectedTimeframe updates only selectedTimeframe", () => {
    useDashboardStore.getState().setSelectedTimeframe("1Y");
    expect(useDashboardStore.getState().selectedTimeframe).toBe("1Y");
    expect(useDashboardStore.getState().selectedSymbol).toBeNull();
  });

  it("setConnectionStatus updates only connectionStatus", () => {
    useDashboardStore.getState().setConnectionStatus("reconnecting");
    expect(useDashboardStore.getState().connectionStatus).toBe("reconnecting");
  });

  it("does not leak state across tests (reset works)", () => {
    expect(useDashboardStore.getState().selectedSymbol).toBeNull();
  });
});
