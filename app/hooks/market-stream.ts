export interface OrderBookLevel {
  price: string;
  size: number;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export type ServerMessage =
  | { type: "snapshot"; symbol: string; price: string; book: OrderBookData; isHalted: boolean }
  | { type: "tick"; symbol: string; price: string; book: OrderBookData; ts: number }
  | { type: "halt"; symbol: string }
  | { type: "resume"; symbol: string; price: string };

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: unknown };
    if (
      data.type === "snapshot" ||
      data.type === "tick" ||
      data.type === "halt" ||
      data.type === "resume"
    ) {
      return data as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export interface SymbolStreamState {
  price: string | null;
  book: OrderBookData | null;
  isHalted: boolean;
}

const EMPTY_STATE: SymbolStreamState = { price: null, book: null, isHalted: false };

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

type MessageListener = (symbol: string, state: SymbolStreamState) => void;
type StatusListener = (status: ConnectionStatus) => void;

// Minimal surface this client needs from a WebSocket — matches the browser
// WebSocket API, but injectable so this is unit-testable without jsdom or a
// real socket (this repo's established pattern, e.g. FrameScheduler).
export interface SocketLike {
  readonly OPEN: number;
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface MarketStreamClientOptions {
  /** Relay base URL, without the token query param. */
  url: string;
  /** Fetches a fresh short-lived WS token — called on every (re)connect. */
  getToken: () => Promise<string>;
  socketFactory: SocketFactory;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  scheduleReconnect?: (callback: () => void, ms: number) => unknown;
}

// Owns the relay WebSocket connection: handshake token fetch, exponential
// backoff reconnect, and resubscribing to every tracked symbol on
// (re)connect so the relay resends a fresh snapshot per symbol before ticks
// resume (SPEC §5) — no duplicate/missing-tick artifacts across a drop.
export class MarketStreamClient {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = "connecting";
  private reconnectAttempts = 0;
  private stopped = false;
  private readonly trackedSymbols = new Set<string>();
  private readonly states = new Map<string, SymbolStreamState>();
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(private readonly options: MarketStreamClientOptions) {}

  connect(): void {
    this.stopped = false;
    void this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  subscribe(symbols: readonly string[]): void {
    const fresh = symbols.filter((s) => !this.trackedSymbols.has(s));
    for (const symbol of symbols) this.trackedSymbols.add(symbol);
    if (fresh.length > 0) this.send({ type: "subscribe", symbols: fresh });
  }

  unsubscribe(symbols: readonly string[]): void {
    for (const symbol of symbols) this.trackedSymbols.delete(symbol);
    this.send({ type: "unsubscribe", symbols: [...symbols] });
  }

  getState(symbol: string): SymbolStreamState {
    return this.states.get(symbol) ?? EMPTY_STATE;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private async openSocket(): Promise<void> {
    if (this.stopped) return;
    // Only the very first attempt announces "connecting" — a retry after a
    // drop already announced "reconnecting" from scheduleReconnect(), and
    // re-announcing it here on the attempt itself would double-fire.
    if (this.reconnectAttempts === 0) this.setStatus("connecting");

    let token: string;
    try {
      token = await this.options.getToken();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const socket = this.options.socketFactory(
      `${this.options.url}?token=${encodeURIComponent(token)}`
    );
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      // Resubscribe to everything tracked so far — this is what makes a
      // reconnect resend a fresh snapshot per symbol instead of leaving the
      // client on stale pre-drop data (SPEC §5).
      if (this.trackedSymbols.size > 0) {
        this.send({ type: "subscribe", symbols: [...this.trackedSymbols] });
      }
    };

    socket.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (message) this.applyMessage(message);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return; // a newer socket already replaced this one
      this.socket = null;
      if (this.stopped) {
        this.setStatus("disconnected");
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setStatus("reconnecting");
    const base = this.options.backoffBaseMs ?? 500;
    const max = this.options.backoffMaxMs ?? 15_000;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, max);
    this.reconnectAttempts += 1;

    const schedule = this.options.scheduleReconnect ?? ((cb, ms) => setTimeout(cb, ms));
    schedule(() => void this.openSocket(), delay);
  }

  private applyMessage(message: ServerMessage): void {
    switch (message.type) {
      case "snapshot":
        this.states.set(message.symbol, {
          price: message.price,
          book: message.book,
          isHalted: message.isHalted,
        });
        break;
      case "tick":
        this.states.set(message.symbol, {
          price: message.price,
          book: message.book,
          isHalted: false,
        });
        break;
      case "halt": {
        const previous = this.states.get(message.symbol) ?? EMPTY_STATE;
        this.states.set(message.symbol, { ...previous, isHalted: true });
        break;
      }
      case "resume": {
        const previous = this.states.get(message.symbol) ?? EMPTY_STATE;
        this.states.set(message.symbol, {
          ...previous,
          price: message.price,
          isHalted: false,
        });
        break;
      }
    }
    this.notify(message.symbol);
  }

  private send(message: { type: "subscribe" | "unsubscribe"; symbols: string[] }): void {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
    // If not currently connected, subscriptions are already recorded in
    // trackedSymbols and get resent in full once the (re)connect completes.
  }

  private notify(symbol: string): void {
    const state = this.getState(symbol);
    for (const listener of this.messageListeners) listener(symbol, state);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
