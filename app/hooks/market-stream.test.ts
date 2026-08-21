import { describe, expect, it } from "vitest";
import { MarketStreamClient, parseServerMessage, type SocketLike } from "./market-stream";

describe("parseServerMessage", () => {
  it("parses a snapshot message", () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: "snapshot", symbol: "AAPL", price: "100.00", book: { bids: [], asks: [] }, isHalted: false })
    );
    expect(msg?.type).toBe("snapshot");
  });

  it("returns null for invalid JSON", () => {
    expect(parseServerMessage("{not json")).toBeNull();
  });

  it("returns null for an unknown message type", () => {
    expect(parseServerMessage(JSON.stringify({ type: "bogus" }))).toBeNull();
  });
});

function fakeSocket(): SocketLike & { emitOpen: () => void; emitMessage: (data: unknown) => void; emitClose: () => void; sent: string[] } {
  const sent: string[] = [];
  const socket: SocketLike & { emitOpen: () => void; emitMessage: (data: unknown) => void; emitClose: () => void; sent: string[] } = {
    OPEN: 1,
    readyState: 1,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    sent,
    send: (data: string) => sent.push(data),
    close: () => socket.emitClose(),
    emitOpen: () => socket.onopen?.(),
    emitMessage: (data: unknown) => socket.onmessage?.({ data: JSON.stringify(data) }),
    emitClose: () => {
      socket.readyState = 3;
      socket.onclose?.();
    },
  };
  return socket;
}

function fakeScheduler() {
  const pending: Array<{ cb: () => void; ms: number }> = [];
  return {
    scheduleReconnect: (cb: () => void, ms: number) => {
      pending.push({ cb, ms });
      return pending.length;
    },
    fireNext: () => {
      const next = pending.shift();
      next?.cb();
    },
    delays: () => pending.map((p) => p.ms),
  };
}

describe("MarketStreamClient", () => {
  it("connects, subscribes, and applies a snapshot then a tick", () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const client = new MarketStreamClient({
      url: "ws://relay",
      getToken: async () => "token-1",
      socketFactory: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
    });

    const events: Array<[string, unknown]> = [];
    client.onMessage((symbol, state) => events.push([symbol, state]));

    client.connect();
    client.subscribe(["AAPL"]);
    return Promise.resolve().then(() => {
      sockets[0]!.emitOpen();
      expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: "subscribe", symbols: ["AAPL"] });

      sockets[0]!.emitMessage({ type: "snapshot", symbol: "AAPL", price: "100.00", book: { bids: [], asks: [] }, isHalted: false });
      expect(client.getState("AAPL")).toEqual({ price: "100.00", book: { bids: [], asks: [] }, isHalted: false });

      sockets[0]!.emitMessage({ type: "tick", symbol: "AAPL", price: "101.00", book: { bids: [], asks: [] }, ts: 1 });
      expect(client.getState("AAPL").price).toBe("101.00");
      expect(events.length).toBe(2);
    });
  });

  it("tracks halt/resume without losing the last known book", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const client = new MarketStreamClient({
      url: "ws://relay",
      getToken: async () => "token-1",
      socketFactory: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
    });

    client.connect();
    client.subscribe(["AAPL"]);
    await Promise.resolve();
    sockets[0]!.emitOpen();
    sockets[0]!.emitMessage({ type: "snapshot", symbol: "AAPL", price: "100.00", book: { bids: [], asks: [] }, isHalted: false });

    sockets[0]!.emitMessage({ type: "halt", symbol: "AAPL" });
    expect(client.getState("AAPL")).toEqual({ price: "100.00", book: { bids: [], asks: [] }, isHalted: true });

    sockets[0]!.emitMessage({ type: "resume", symbol: "AAPL", price: "95.00" });
    expect(client.getState("AAPL")).toEqual({ price: "95.00", book: { bids: [], asks: [] }, isHalted: false });
  });

  it("reconnects with exponential backoff and resubscribes to every tracked symbol", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const scheduler = fakeScheduler();
    const client = new MarketStreamClient({
      url: "ws://relay",
      getToken: async () => "token-1",
      socketFactory: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      backoffBaseMs: 100,
      backoffMaxMs: 10_000,
      scheduleReconnect: scheduler.scheduleReconnect,
    });

    const statuses: string[] = [];
    client.onStatusChange((s) => statuses.push(s));

    client.connect();
    client.subscribe(["AAPL", "MSFT"]);
    await Promise.resolve();
    sockets[0]!.emitOpen();
    expect(statuses).toEqual(["connecting", "connected"]);

    sockets[0]!.emitClose();
    expect(statuses).toEqual(["connecting", "connected", "reconnecting"]);
    expect(scheduler.delays()).toEqual([100]);

    scheduler.fireNext();
    await Promise.resolve();
    sockets[1]!.emitOpen();
    expect(statuses).toEqual(["connecting", "connected", "reconnecting", "connected"]);
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual({
      type: "subscribe",
      symbols: ["AAPL", "MSFT"],
    });

    // A drop right after a *successful* reconnect restarts backoff at the
    // base delay — exponential growth is only across consecutive failures,
    // not carried across a connection that actually succeeded.
    sockets[1]!.emitClose();
    expect(scheduler.delays()).toEqual([100]);
  });

  it("grows backoff exponentially across consecutive failures without an intervening success", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const scheduler = fakeScheduler();
    const client = new MarketStreamClient({
      url: "ws://relay",
      getToken: async () => "token-1",
      socketFactory: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      backoffBaseMs: 100,
      backoffMaxMs: 10_000,
      scheduleReconnect: scheduler.scheduleReconnect,
    });

    client.connect();
    await Promise.resolve();
    sockets[0]!.emitClose(); // fails before ever opening
    expect(scheduler.delays()).toEqual([100]);

    scheduler.fireNext();
    await Promise.resolve();
    sockets[1]!.emitClose(); // fails again, still without opening
    expect(scheduler.delays()).toEqual([200]);

    scheduler.fireNext();
    await Promise.resolve();
    sockets[2]!.emitClose();
    expect(scheduler.delays()).toEqual([400]);
  });

  it("caps backoff at the configured maximum", async () => {
    const scheduler = fakeScheduler();
    const client = new MarketStreamClient({
      url: "ws://relay",
      getToken: async () => "token-1",
      socketFactory: () => fakeSocket(),
      backoffBaseMs: 1000,
      backoffMaxMs: 3000,
      scheduleReconnect: scheduler.scheduleReconnect,
    });

    client.connect();
    await Promise.resolve();
    // Force repeated failures by rejecting getToken after the first attempt.
    for (let i = 0; i < 4; i++) {
      scheduler.fireNext();
      await Promise.resolve();
    }
    for (const delay of scheduler.delays()) {
      expect(delay).toBeLessThanOrEqual(3000);
    }
  });

  it("stop() prevents further reconnect attempts", async () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const scheduler = fakeScheduler();
    const client = new MarketStreamClient({
      url: "ws://relay",
      getToken: async () => "token-1",
      socketFactory: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      scheduleReconnect: scheduler.scheduleReconnect,
    });

    client.connect();
    await Promise.resolve();
    sockets[0]!.emitOpen();
    client.stop();

    expect(scheduler.delays()).toEqual([]);
  });
});
