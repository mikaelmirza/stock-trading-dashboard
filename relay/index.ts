import "dotenv/config";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyWsToken } from "./jwt";
import { ConnectionManager, createPrismaDataSource, type ClientConnection } from "./connection-manager";

export interface ClientMessage {
  type: "subscribe" | "unsubscribe";
  symbols: string[];
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      (data as { type: unknown }).type &&
      ((data as { type: unknown }).type === "subscribe" ||
        (data as { type: unknown }).type === "unsubscribe") &&
      "symbols" in data &&
      Array.isArray((data as { symbols: unknown }).symbols)
    ) {
      const { type, symbols } = data as { type: "subscribe" | "unsubscribe"; symbols: unknown[] };
      return { type, symbols: symbols.filter((s): s is string => typeof s === "string") };
    }
    return null;
  } catch {
    return null;
  }
}

export function toClientConnection(ws: WebSocket): ClientConnection {
  return {
    send: (data: string) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
  };
}

export async function handleConnection(
  ws: WebSocket,
  request: IncomingMessage,
  manager: ConnectionManager
): Promise<void> {
  const url = new URL(request.url ?? "", "http://relay");
  const token = url.searchParams.get("token");
  const session = token ? await verifyWsToken(token) : null;

  if (!session) {
    ws.close(4001, "unauthorized");
    return;
  }

  const client = toClientConnection(ws);

  ws.on("message", (raw: Buffer) => {
    const message = parseClientMessage(raw.toString());
    if (!message) return;
    if (message.type === "subscribe") {
      for (const symbol of message.symbols) {
        void manager.subscribe(client, symbol);
      }
    } else {
      for (const symbol of message.symbols) {
        manager.unsubscribe(client, symbol);
      }
    }
  });

  ws.on("close", () => {
    manager.unsubscribeAll(client);
  });
}

export function startRelay(
  port: number,
  manager: ConnectionManager = new ConnectionManager({ dataSource: createPrismaDataSource() })
): WebSocketServer {
  const wss = new WebSocketServer({ port });
  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    void handleConnection(ws, request, manager);
  });
  return wss;
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const port = Number(process.env["RELAY_PORT"] ?? 8080);
  startRelay(port);
  console.log(`relay listening on port ${port}`);
}
