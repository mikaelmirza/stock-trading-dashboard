import { describe, expect, it, vi } from "vitest";
import {
  ConnectionManager,
  type ClientConnection,
  type ServerMessage,
  type SymbolDataSource,
} from "./connection-manager";
import { mulberry32 } from "./market-engine";

function fakeClient(): ClientConnection & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return {
    messages,
    send(data: string) {
      messages.push(JSON.parse(data) as ServerMessage);
    },
  };
}

function fakeDataSource(overrides?: Partial<SymbolDataSource>): SymbolDataSource & {
  persisted: Map<string, { price: string; isHalted: boolean }>;
} {
  const persisted = new Map<string, { price: string; isHalted: boolean }>();
  return {
    persisted,
    loadSeedCloses: overrides?.loadSeedCloses ?? (async () => [100, 101, 99, 102, 103]),
    loadSymbolState: overrides?.loadSymbolState ?? (async () => null),
    persistSymbolState:
      overrides?.persistSymbolState ??
      (async (symbol, price, isHalted) => {
        persisted.set(symbol, { price, isHalted });
      }),
  };
}

// A fake scheduler that never actually schedules on its own — tests fire
// ticks manually via fireNext(), which is what makes the throttle/halt
// timing assertions below deterministic instead of racing real timers.
function fakeScheduler() {
  const pending = new Map<number, () => void>();
  let nextHandle = 1;
  let currentTime = 0;

  return {
    now: () => currentTime,
    advance: (ms: number) => {
      currentTime += ms;
    },
    scheduleTick: (cb: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    },
    clearTick: (handle: unknown) => {
      pending.delete(handle as number);
    },
    fireAll: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
    pendingCount: () => pending.size,
  };
}

describe("ConnectionManager", () => {
  it("starts a symbol's simulation on first subscribe and sends an initial snapshot", async () => {
    const dataSource = fakeDataSource();
    const scheduler = fakeScheduler();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 500,
    });

    const client = fakeClient();
    await manager.subscribe(client, "AAPL");

    expect(manager.activeSymbols).toEqual(["AAPL"]);
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]).toMatchObject({ type: "snapshot", symbol: "AAPL" });
  });

  it("stops the symbol's simulation on the last unsubscribe", async () => {
    const dataSource = fakeDataSource();
    const scheduler = fakeScheduler();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 500,
    });

    const clientA = fakeClient();
    const clientB = fakeClient();
    await manager.subscribe(clientA, "AAPL");
    await manager.subscribe(clientB, "AAPL");
    expect(scheduler.pendingCount()).toBe(1);

    manager.unsubscribe(clientA, "AAPL");
    expect(manager.activeSymbols).toEqual(["AAPL"]); // still one subscriber left

    manager.unsubscribe(clientB, "AAPL");
    expect(manager.activeSymbols).toEqual([]);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("delivers ticks only to clients subscribed to that symbol", async () => {
    const dataSource = fakeDataSource();
    const scheduler = fakeScheduler();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 500,
      rngFactory: () => mulberry32(1),
    });

    const aaplClient = fakeClient();
    const msftClient = fakeClient();
    await manager.subscribe(aaplClient, "AAPL");
    await manager.subscribe(msftClient, "MSFT");

    scheduler.advance(500);
    scheduler.fireAll();

    const aaplTicks = aaplClient.messages.filter((m) => m.type === "tick");
    const msftTicksOnAapl = aaplClient.messages.filter(
      (m) => m.type === "tick" && m.symbol === "MSFT"
    );
    expect(aaplTicks.length).toBeGreaterThan(0);
    expect(msftTicksOnAapl).toHaveLength(0);
  });

  it("resumes from the last persisted price rather than the seed-derived price", async () => {
    const dataSource = fakeDataSource({
      loadSymbolState: async (symbol) =>
        symbol === "AAPL" ? { lastPrice: "555.0000", isHalted: false } : null,
    });
    const scheduler = fakeScheduler();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 500,
    });

    const client = fakeClient();
    await manager.subscribe(client, "AAPL");
    const snapshot = client.messages[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snapshot.price).toBe("555.0000");
  });

  it("throttles SymbolState writes to at most once per throttle window", async () => {
    const dataSource = fakeDataSource();
    const scheduler = fakeScheduler();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 100,
      persistThrottleMs: 1000,
      rngFactory: () => mulberry32(1),
    });

    const persistSpy = vi.spyOn(dataSource, "persistSymbolState");
    const client = fakeClient();
    await manager.subscribe(client, "AAPL");

    for (let i = 0; i < 5; i++) {
      scheduler.advance(100);
      scheduler.fireAll();
    }

    // 5 ticks at 100ms apart = 500ms elapsed, well under the 1000ms throttle.
    expect(persistSpy).not.toHaveBeenCalled();

    scheduler.advance(600); // crosses the 1000ms threshold
    scheduler.fireAll();
    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("writes halt/resume transitions through immediately, unthrottled", async () => {
    // rng forces an anomaly on the very first tick.
    const forcedHaltRng = () => {
      const values = [0.5, 0.5, 0.0, 0.9];
      let i = 0;
      return () => values[i++] ?? 0.5;
    };

    const dataSource = fakeDataSource();
    const scheduler = fakeScheduler();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 100,
      persistThrottleMs: 60_000, // deliberately huge — halt must bypass this
      rngFactory: forcedHaltRng,
    });
    const persistSpy = vi.spyOn(dataSource, "persistSymbolState");

    const client = fakeClient();
    await manager.subscribe(client, "AAPL");

    scheduler.advance(100);
    scheduler.fireAll();

    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenLastCalledWith("AAPL", expect.any(String), true);
    expect(client.messages.some((m) => m.type === "halt")).toBe(true);
  });

  it("carries isHalted in the snapshot for a symbol that's already halted", async () => {
    const dataSource = fakeDataSource({
      loadSymbolState: async () => ({ lastPrice: "100.0000", isHalted: true }),
    });
    const scheduler = fakeScheduler();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 500,
    });

    const client = fakeClient();
    await manager.subscribe(client, "AAPL");
    const snapshot = client.messages[0] as Extract<ServerMessage, { type: "snapshot" }>;
    expect(snapshot.isHalted).toBe(true);
  });

  it("does not stall tick delivery when persistence fails", async () => {
    const dataSource = fakeDataSource({
      persistSymbolState: async () => {
        throw new Error("db unreachable");
      },
    });
    const scheduler = fakeScheduler();
    const onLog = vi.fn();
    const manager = new ConnectionManager({
      dataSource,
      now: scheduler.now,
      scheduleTick: scheduler.scheduleTick,
      clearTick: scheduler.clearTick,
      randomTickIntervalMs: () => 100,
      persistThrottleMs: 0,
      rngFactory: () => mulberry32(1),
      onLog,
    });

    const client = fakeClient();
    await manager.subscribe(client, "AAPL");

    scheduler.advance(100);
    scheduler.fireAll();
    // Flush the rejected persistSymbolState promise.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ticks = client.messages.filter((m) => m.type === "tick");
    expect(ticks.length).toBeGreaterThan(0);
    expect(onLog).toHaveBeenCalled();
  });
});
