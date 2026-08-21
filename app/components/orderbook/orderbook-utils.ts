import type { OrderBookData, OrderBookLevel } from "@/app/hooks/market-stream";
import type { ConnectionStatus } from "@/app/store/dashboard-store";

export interface FrameSchedulerFns {
  requestFrame: (cb: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
}

export const rafScheduler: FrameSchedulerFns = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

// Coalesces rapid pushes into at most one flush per animation frame (SPEC
// §8: order book updates "batched and flushed on requestAnimationFrame
// rather than re-rendering per incoming message, to stay smooth under rapid
// ticks"). Only the most recently pushed value survives to the flush —
// intermediate ticks that land within the same frame are overwritten, not
// queued. Scheduler is injectable so this is unit-testable without a real
// browser frame loop (no jsdom in this project — see app/hooks/market-stream
// for the same injectable-dependency pattern applied to sockets).
export class FrameBatcher<T> {
  private pending: T;
  private handle: number | null = null;

  constructor(
    initial: T,
    private readonly onFlush: (value: T) => void,
    private readonly scheduler: FrameSchedulerFns = rafScheduler
  ) {
    this.pending = initial;
  }

  push(value: T): void {
    this.pending = value;
    if (this.handle !== null) return;
    this.handle = this.scheduler.requestFrame(() => {
      this.handle = null;
      this.onFlush(this.pending);
    });
  }

  stop(): void {
    if (this.handle !== null) {
      this.scheduler.cancelFrame(this.handle);
      this.handle = null;
    }
  }
}

// relay/order-book.ts emits asks ascending away from the touch (index 0 =
// best ask). Ladders conventionally render furthest-first top to nearest at
// the spread, so this is displayed in reverse of wire order.
export function asksTopDown(book: OrderBookData | null): OrderBookLevel[] {
  return book ? [...book.asks].reverse() : [];
}

// Largest size across both sides of the book, for scaling depth-bar widths
// relative to each other. 0 (rather than -Infinity) when there's no book yet
// so callers can divide by it without a NaN/Infinity guard.
export function maxLevelSize(book: OrderBookData | null): number {
  if (!book) return 0;
  let max = 0;
  for (const level of book.bids) if (level.size > max) max = level.size;
  for (const level of book.asks) if (level.size > max) max = level.size;
  return max;
}

export function depthRatio(size: number, max: number): number {
  return max > 0 ? size / max : 0;
}

// PLAN step 36: distinct empty/loading copy for the order book, separate
// from the chart's own (history-fetch-driven) messaging. A missing book
// while connected means the relay hasn't written this symbol's first tick
// yet (it only starts simulating a symbol once subscribed — SPEC §4) —
// that's a different wait from not being connected at all, so the two get
// different copy rather than one generic "loading" string.
export function orderBookEmptyMessage(
  symbol: string | null,
  book: OrderBookData | null,
  connectionStatus: ConnectionStatus
): string | null {
  if (symbol === null) return "Select a symbol";
  if (book !== null) return null;
  return connectionStatus === "connected" ? "Waiting for first tick…" : "Connecting to live data…";
}
