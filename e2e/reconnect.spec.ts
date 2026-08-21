import { test, expect, type WebSocketRoute } from "@playwright/test";

// PLAN step 40 (second scenario): simulate a dropped WS connection and
// verify the UI reconnects and resyncs without leaving stale data on
// screen (SPEC §5/§9). Rather than actually killing the relay process (hard
// to coordinate reliably from within a single test), this intercepts the
// page's WebSocket via page.routeWebSocket -- proxying every message
// through to the real relay untouched, so the test drives a real relay +
// real Postgres-backed SymbolState, not a mock of one. Only the *drop*
// itself is test-controlled: the test waits for the connection to reach a
// confirmed steady "connected" state, then force-closes it directly, so
// the transient "reconnecting" window starts only after the test has begun
// watching for it (an internal timer-based drop raced the test's own
// assertions and proved flaky -- the reconnect could complete in well
// under a second, before the first poll).
test("recovers from a dropped WS connection with a visible reconnect and resnapshot", async ({
  page,
}) => {
  let connectionCount = 0;
  let activeClientSocket: WebSocketRoute | null = null;

  await page.routeWebSocket(/^ws:\/\/localhost:8080\//, (clientSocket) => {
    connectionCount += 1;
    activeClientSocket = clientSocket;
    const serverSocket = clientSocket.connectToServer();
    clientSocket.onMessage((message) => serverSocket.send(message));
    serverSocket.onMessage((message) => clientSocket.send(message));
  });

  await page.goto("/");
  // Generous timeout: this may be the first hit on /dashboard in the run,
  // and Next.js/Turbopack's first compile of a route can outlast the
  // default 5s assertion timeout.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  const watchlist = page.getByTestId("watchlist-widget");
  await watchlist.getByRole("row", { name: /AAPL/ }).click();

  const holdings = page.getByTestId("holdings-widget");
  const buyButton = holdings.getByRole("button", { name: "Buy" });
  // Confirmed steady "connected" state: a live client-side price has
  // arrived (canSubmitTrade's hasPrice gate). React Strict Mode's dev-mode
  // double-invoked effects mean this may already be the 2nd (or later)
  // connection, not necessarily the 1st -- activeClientSocket always tracks
  // whichever one is currently live.
  await expect(buyButton).toBeEnabled({ timeout: 15_000 });
  const connectionsBeforeDrop = connectionCount;

  activeClientSocket!.close();

  // The forced close drives the client through connected -> reconnecting;
  // ConnectionBanner surfaces that transition directly off the shared
  // connectionStatus store field.
  await expect(page.getByText("Reconnecting…")).toBeVisible({ timeout: 5_000 });

  // Backoff is 500ms base (market-stream.ts), so recovery is fast -- the
  // banner (which renders nothing once connected) disappearing again is the
  // client-observable proof that reconnect + resubscribe + fresh snapshot
  // all completed, with no stuck "Reconnecting…" state left behind.
  await expect(page.getByText("Reconnecting…")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("Connecting to live data…")).toBeHidden();

  // Live data actually resumed post-reconnect, not just the banner clearing.
  await expect(buyButton).toBeEnabled({ timeout: 15_000 });

  expect(connectionCount).toBeGreaterThan(connectionsBeforeDrop);
});
