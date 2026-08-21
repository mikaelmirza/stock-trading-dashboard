import { db } from "@/app/lib/db";
import { MarketEngine, computeDriftVolatility } from "./market-engine";
import { deriveOrderBook, type OrderBookData } from "./order-book";

export interface ClientConnection {
  send(data: string): void;
}

export type ServerMessage =
  | { type: "snapshot"; symbol: string; price: string; book: OrderBookData; isHalted: boolean }
  | { type: "tick"; symbol: string; price: string; book: OrderBookData; ts: number }
  | { type: "halt"; symbol: string }
  | { type: "resume"; symbol: string; price: string };

export interface SymbolDataSource {
  loadSeedCloses(symbol: string): Promise<number[]>;
  loadSymbolState(symbol: string): Promise<{ lastPrice: string; isHalted: boolean } | null>;
  persistSymbolState(symbol: string, price: string, isHalted: boolean): Promise<void>;
}

interface SymbolRuntime {
  engine: MarketEngine;
  subscribers: Set<ClientConnection>;
  timer: unknown;
  lastPersistedAt: number;
}

export interface ConnectionManagerOptions {
  dataSource: SymbolDataSource;
  minTickMs?: number;
  maxTickMs?: number;
  persistThrottleMs?: number;
  now?: () => number;
  scheduleTick?: (callback: () => void, ms: number) => unknown;
  clearTick?: (handle: unknown) => void;
  randomTickIntervalMs?: () => number;
  rngFactory?: (symbol: string) => () => number;
  onLog?: (message: string, error?: unknown) => void;
}

// Subscribe/unsubscribe fan-out, per-symbol simulation lifecycle, and the
// relay's side of the SymbolState bridge (SPEC §5, PLAN steps 19/22). A
// symbol only ticks while at least one client is subscribed; the last
// unsubscribe stops it, so unwatched symbols cost nothing.
export class ConnectionManager {
  private readonly runtimes = new Map<string, SymbolRuntime>();
  private readonly dataSource: SymbolDataSource;
  private readonly minTickMs: number;
  private readonly maxTickMs: number;
  private readonly persistThrottleMs: number;
  private readonly now: () => number;
  private readonly scheduleTick: (callback: () => void, ms: number) => unknown;
  private readonly clearTick: (handle: unknown) => void;
  private readonly randomTickIntervalMs: () => number;
  private readonly rngFactory?: (symbol: string) => () => number;
  private readonly onLog: (message: string, error?: unknown) => void;

  constructor(options: ConnectionManagerOptions) {
    this.dataSource = options.dataSource;
    this.minTickMs = options.minTickMs ?? 250;
    this.maxTickMs = options.maxTickMs ?? 1000;
    this.persistThrottleMs = options.persistThrottleMs ?? 1000;
    this.now = options.now ?? Date.now;
    this.scheduleTick = options.scheduleTick ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTick = options.clearTick ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.randomTickIntervalMs =
      options.randomTickIntervalMs ??
      (() => this.minTickMs + Math.random() * (this.maxTickMs - this.minTickMs));
    this.rngFactory = options.rngFactory;
    this.onLog = options.onLog ?? ((message, error) => console.error(message, error));
  }

  get activeSymbols(): string[] {
    return [...this.runtimes.keys()];
  }

  subscriberCount(symbol: string): number {
    return this.runtimes.get(symbol)?.subscribers.size ?? 0;
  }

  async subscribe(client: ClientConnection, symbol: string): Promise<void> {
    let runtime = this.runtimes.get(symbol);
    if (!runtime) {
      runtime = await this.startSymbol(symbol);
      // A concurrent subscribe for the same symbol could have started it
      // first while this one was awaiting seed/state data — don't clobber.
      runtime = this.runtimes.get(symbol) ?? runtime;
      this.runtimes.set(symbol, runtime);
    }
    runtime.subscribers.add(client);

    // Snapshot carries isHalted, not just price (SPEC §5) — a client that
    // subscribes while a symbol is already halted has no other way to learn
    // that, since halt/resume messages only fire on the transition.
    const state = runtime.engine.getState();
    this.sendTo(client, {
      type: "snapshot",
      symbol,
      price: state.price,
      book: deriveOrderBook(state.price),
      isHalted: state.isHalted,
    });
  }

  unsubscribe(client: ClientConnection, symbol: string): void {
    const runtime = this.runtimes.get(symbol);
    if (!runtime) return;
    runtime.subscribers.delete(client);
    if (runtime.subscribers.size === 0) {
      this.clearTick(runtime.timer);
      this.runtimes.delete(symbol);
    }
  }

  unsubscribeAll(client: ClientConnection): void {
    for (const symbol of this.activeSymbols) {
      this.unsubscribe(client, symbol);
    }
  }

  private async startSymbol(symbol: string): Promise<SymbolRuntime> {
    const [closes, persisted] = await Promise.all([
      this.dataSource.loadSeedCloses(symbol),
      this.dataSource.loadSymbolState(symbol),
    ]);
    const { drift, volatility } = computeDriftVolatility(closes);
    // Continuity: resume from the last persisted price rather than jumping
    // back to the seed-derived starting price (PLAN step 22) — a relay
    // restart shouldn't look like a price jump to a connected client.
    const startPrice = persisted ? Number(persisted.lastPrice) : (closes.at(-1) ?? 100);

    const engine = new MarketEngine({
      symbol,
      startPrice,
      drift,
      volatility,
      rng: this.rngFactory?.(symbol),
      startHalted: persisted?.isHalted ?? false,
    });

    const runtime: SymbolRuntime = {
      engine,
      subscribers: new Set(),
      timer: undefined,
      lastPersistedAt: 0,
    };
    this.scheduleNextTick(symbol, runtime);
    return runtime;
  }

  private scheduleNextTick(symbol: string, runtime: SymbolRuntime): void {
    runtime.timer = this.scheduleTick(() => this.onTick(symbol, runtime), this.randomTickIntervalMs());
  }

  private onTick(symbol: string, runtime: SymbolRuntime): void {
    if (!this.runtimes.has(symbol)) return; // stopped between schedule and fire

    const outcome = runtime.engine.tick(this.now());

    switch (outcome.kind) {
      case "waiting":
        break;
      case "tick": {
        const book = deriveOrderBook(outcome.price);
        this.broadcast(runtime, { type: "tick", symbol, price: outcome.price, book, ts: this.now() });
        this.maybePersist(symbol, runtime, outcome.price, false);
        break;
      }
      case "halted":
        this.broadcast(runtime, { type: "halt", symbol });
        this.persistThrough(symbol, runtime, outcome.price, true);
        break;
      case "resumed":
        this.broadcast(runtime, { type: "resume", symbol, price: outcome.price });
        this.persistThrough(symbol, runtime, outcome.price, false);
        break;
    }

    this.scheduleNextTick(symbol, runtime);
  }

  private maybePersist(symbol: string, runtime: SymbolRuntime, price: string, isHalted: boolean): void {
    if (this.now() - runtime.lastPersistedAt < this.persistThrottleMs) return;
    this.persistThrough(symbol, runtime, price, isHalted);
  }

  // Fire-and-forget relative to the broadcast loop (PLAN step 22): never
  // awaited before a tick reaches subscribers, and a failure is logged, not
  // thrown, so a slow/down DB never stalls live tick delivery.
  private persistThrough(symbol: string, runtime: SymbolRuntime, price: string, isHalted: boolean): void {
    runtime.lastPersistedAt = this.now();
    this.dataSource.persistSymbolState(symbol, price, isHalted).catch((error: unknown) => {
      this.onLog(`failed to persist SymbolState for ${symbol}`, error);
    });
  }

  private broadcast(runtime: SymbolRuntime, message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of runtime.subscribers) {
      client.send(payload);
    }
  }

  private sendTo(client: ClientConnection, message: ServerMessage): void {
    client.send(JSON.stringify(message));
  }
}

export function createPrismaDataSource(): SymbolDataSource {
  return {
    async loadSeedCloses(symbol) {
      const rows = await db.seedPriceHistory.findMany({
        where: { symbol },
        orderBy: { date: "asc" },
        select: { close: true },
      });
      return rows.map((row) => row.close.toNumber());
    },
    async loadSymbolState(symbol) {
      const row = await db.symbolState.findUnique({ where: { symbol } });
      if (!row) return null;
      return { lastPrice: row.lastPrice.toString(), isHalted: row.isHalted };
    },
    async persistSymbolState(symbol, price, isHalted) {
      await db.symbolState.upsert({
        where: { symbol },
        create: { symbol, lastPrice: price, isHalted },
        update: { lastPrice: price, isHalted },
      });
    },
  };
}
