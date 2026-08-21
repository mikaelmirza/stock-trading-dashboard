import { describe, expect, it, vi } from "vitest";
import {
  FrameBatcher,
  asksTopDown,
  depthRatio,
  maxLevelSize,
  orderBookEmptyMessage,
  type FrameSchedulerFns,
} from "./orderbook-utils";
import type { OrderBookData } from "@/app/hooks/market-stream";

function fakeScheduler(): FrameSchedulerFns & { fireFrame: () => void; canceled: number[] } {
  let queued: FrameRequestCallback | null = null;
  const canceled: number[] = [];
  return {
    requestFrame: (cb) => {
      queued = cb;
      return 1;
    },
    cancelFrame: (handle) => {
      canceled.push(handle);
      queued = null;
    },
    fireFrame: () => {
      const cb = queued;
      queued = null;
      cb?.(0);
    },
    canceled,
  };
}

describe("FrameBatcher", () => {
  it("does not flush until a frame fires", () => {
    const onFlush = vi.fn();
    const scheduler = fakeScheduler();
    const batcher = new FrameBatcher<string>("initial", onFlush, scheduler);

    batcher.push("a");
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("coalesces multiple pushes within a frame into a single flush of the latest value", () => {
    const onFlush = vi.fn();
    const scheduler = fakeScheduler();
    const batcher = new FrameBatcher<string>("initial", onFlush, scheduler);

    batcher.push("a");
    batcher.push("b");
    batcher.push("c");
    scheduler.fireFrame();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("c");
  });

  it("schedules a fresh frame for pushes that arrive after a flush", () => {
    const onFlush = vi.fn();
    const scheduler = fakeScheduler();
    const batcher = new FrameBatcher<string>("initial", onFlush, scheduler);

    batcher.push("a");
    scheduler.fireFrame();
    batcher.push("b");
    scheduler.fireFrame();

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(2, "b");
  });

  it("cancels the pending frame on stop", () => {
    const onFlush = vi.fn();
    const scheduler = fakeScheduler();
    const batcher = new FrameBatcher<string>("initial", onFlush, scheduler);

    batcher.push("a");
    batcher.stop();
    scheduler.fireFrame();

    expect(onFlush).not.toHaveBeenCalled();
    expect(scheduler.canceled).toEqual([1]);
  });
});

const sampleBook: OrderBookData = {
  bids: [
    { price: "99.50", size: 100 },
    { price: "99.00", size: 150 },
  ],
  asks: [
    { price: "100.50", size: 120 },
    { price: "101.00", size: 300 },
  ],
};

describe("asksTopDown", () => {
  it("reverses wire order so the furthest ask renders first", () => {
    expect(asksTopDown(sampleBook)).toEqual([
      { price: "101.00", size: 300 },
      { price: "100.50", size: 120 },
    ]);
  });

  it("returns an empty array for no book", () => {
    expect(asksTopDown(null)).toEqual([]);
  });
});

describe("maxLevelSize", () => {
  it("finds the largest size across both sides", () => {
    expect(maxLevelSize(sampleBook)).toBe(300);
  });

  it("is 0 for no book", () => {
    expect(maxLevelSize(null)).toBe(0);
  });
});

describe("depthRatio", () => {
  it("scales size relative to the max", () => {
    expect(depthRatio(150, 300)).toBe(0.5);
  });

  it("is 0 when max is 0, without dividing by zero", () => {
    expect(depthRatio(0, 0)).toBe(0);
  });
});

describe("orderBookEmptyMessage", () => {
  it("prompts to select a symbol when none is selected, regardless of connection status", () => {
    expect(orderBookEmptyMessage(null, null, "connected")).toBe("Select a symbol");
    expect(orderBookEmptyMessage(null, sampleBook, "disconnected")).toBe("Select a symbol");
  });

  it("distinguishes waiting-for-first-tick from not-yet-connected", () => {
    expect(orderBookEmptyMessage("AAPL", null, "connected")).toBe("Waiting for first tick…");
    expect(orderBookEmptyMessage("AAPL", null, "connecting")).toBe("Connecting to live data…");
    expect(orderBookEmptyMessage("AAPL", null, "reconnecting")).toBe("Connecting to live data…");
    expect(orderBookEmptyMessage("AAPL", null, "disconnected")).toBe("Connecting to live data…");
  });

  it("shows nothing once a book has arrived", () => {
    expect(orderBookEmptyMessage("AAPL", sampleBook, "connected")).toBeNull();
  });
});
