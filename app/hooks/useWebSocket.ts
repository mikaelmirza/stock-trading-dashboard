"use client";

import { useEffect, useState } from "react";
import { MarketStreamClient, type SocketLike } from "@/app/hooks/market-stream";
import { useDashboardStore } from "@/app/store/dashboard-store";

async function fetchWsToken(): Promise<string> {
  const res = await fetch("/api/ws-token");
  if (!res.ok) throw new Error(`ws-token fetch failed: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

const RELAY_URL = process.env["NEXT_PUBLIC_RELAY_URL"] ?? "ws://localhost:8080";

// The browser WebSocket's handler properties are typed to receive an Event
// argument (`(ev: Event) => any`), which doesn't structurally satisfy
// SocketLike's plain `() => void` handlers used for testability elsewhere
// in market-stream.ts. This adapts a real WebSocket to that minimal shape
// rather than loosening (and re-verifying) the already-tested interface.
function toSocketLike(ws: WebSocket): SocketLike {
  const socketLike: SocketLike = {
    OPEN: WebSocket.OPEN,
    get readyState() {
      return ws.readyState;
    },
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
  ws.onopen = () => socketLike.onopen?.();
  ws.onclose = () => socketLike.onclose?.();
  ws.onerror = () => socketLike.onerror?.();
  ws.onmessage = (event) => socketLike.onmessage?.({ data: event.data as string });
  return socketLike;
}

// Owns the one WS connection lifecycle for the whole dashboard (PLAN step
// 26): mints a fresh short-lived token per (re)connect, subscribes to the
// full watchlist up front (not just the selected symbol, so switching the
// watchlist selection never has to wait on a fresh subscribe), and mirrors
// connection status into the shared store for ConnectionBanner.
export function useWebSocket(symbols: readonly string[]): { client: MarketStreamClient } {
  const setConnectionStatus = useDashboardStore((s) => s.setConnectionStatus);
  const [client] = useState(
    () =>
      new MarketStreamClient({
        url: RELAY_URL,
        getToken: fetchWsToken,
        socketFactory: (url) => toSocketLike(new WebSocket(url)),
      })
  );

  useEffect(() => {
    const unsubscribe = client.onStatusChange(setConnectionStatus);
    client.connect();
    return () => {
      unsubscribe();
      client.stop();
    };
    // client is a stable useState instance; setConnectionStatus is a stable
    // Zustand action reference — both intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const symbolsKey = symbols.join(",");
  useEffect(() => {
    if (symbols.length > 0) client.subscribe(symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, symbolsKey]);

  return { client };
}
