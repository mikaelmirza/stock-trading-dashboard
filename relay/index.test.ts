import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { SignJWT } from "jose";
import { startRelay, parseClientMessage } from "./index";
import { ConnectionManager, type SymbolDataSource } from "./connection-manager";

const key = new TextEncoder().encode(process.env["WS_JWT_SECRET"]);
const PORT = 8991;

async function makeToken(userId = "user_1"): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(key);
}

function fakeDataSource(): SymbolDataSource {
  return {
    loadSeedCloses: async () => [100, 101, 99, 102, 103],
    loadSymbolState: async () => null,
    persistSymbolState: async () => {},
  };
}

describe("parseClientMessage", () => {
  it("parses a valid subscribe message", () => {
    expect(parseClientMessage(JSON.stringify({ type: "subscribe", symbols: ["AAPL"] }))).toEqual({
      type: "subscribe",
      symbols: ["AAPL"],
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseClientMessage("not json")).toBeNull();
  });

  it("returns null for an unknown message type", () => {
    expect(parseClientMessage(JSON.stringify({ type: "bogus", symbols: [] }))).toBeNull();
  });

  it("returns null when symbols is missing", () => {
    expect(parseClientMessage(JSON.stringify({ type: "subscribe" }))).toBeNull();
  });
});

describe("relay server", () => {
  let wss: ReturnType<typeof startRelay> | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
    wss = undefined;
  });

  it("closes the connection when no token is provided", async () => {
    wss = startRelay(PORT, new ConnectionManager({ dataSource: fakeDataSource() }));
    await new Promise((resolve) => wss!.once("listening", resolve));

    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const closeCode = await new Promise<number>((resolve) => ws.on("close", resolve));
    expect(closeCode).toBe(4001);
  });

  it("closes the connection for an invalid/tampered token", async () => {
    wss = startRelay(PORT, new ConnectionManager({ dataSource: fakeDataSource() }));
    await new Promise((resolve) => wss!.once("listening", resolve));

    const ws = new WebSocket(`ws://localhost:${PORT}?token=garbage`);
    const closeCode = await new Promise<number>((resolve) => ws.on("close", resolve));
    expect(closeCode).toBe(4001);
  });

  it("accepts a valid token and streams a snapshot then ticks after subscribing", async () => {
    const manager = new ConnectionManager({
      dataSource: fakeDataSource(),
      randomTickIntervalMs: () => 30,
    });
    wss = startRelay(PORT, manager);
    await new Promise((resolve) => wss!.once("listening", resolve));

    const token = await makeToken();
    const ws = new WebSocket(`ws://localhost:${PORT}?token=${token}`);
    await new Promise((resolve) => ws.once("open", resolve));

    const messages: Array<{ type: string; symbol?: string }> = [];
    ws.on("message", (data: Buffer) => messages.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({ type: "subscribe", symbols: ["AAPL"] }));

    await vi.waitFor(
      () => {
        expect(messages.some((m) => m.type === "snapshot" && m.symbol === "AAPL")).toBe(true);
      },
      { timeout: 1000 }
    );
    await vi.waitFor(
      () => {
        expect(messages.some((m) => m.type === "tick" && m.symbol === "AAPL")).toBe(true);
      },
      { timeout: 1000 }
    );

    ws.close();
  });
});
