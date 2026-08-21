import { defineConfig, devices } from "@playwright/test";

// PLAN step 40: guest auto-provision -> select symbol -> trade -> see
// holdings/P&L update live, plus a dropped-WS-connection reconnect/resync
// scenario, run against the full local stack (Next.js dev server + relay +
// local Postgres, per SPEC §10/§11). Postgres itself isn't started here — it
// runs as a standing local service (see .env's DATABASE_URL) — only the two
// Node processes are.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
      stdout: "pipe",
    },
    {
      // Relay is a raw `ws` server with no HTTP handler, so a `url` health
      // check (which needs a real HTTP response) would hang forever — `port`
      // only waits for the TCP port to accept connections.
      command: "npm run relay:dev",
      port: 8080,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      stdout: "pipe",
    },
  ],
});
