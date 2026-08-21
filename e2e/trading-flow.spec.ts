import { test, expect } from "@playwright/test";

// PLAN step 40 (first scenario): guest auto-provision -> select symbol ->
// trade -> see holdings/P&L update live. Each Playwright test gets a fresh
// browser context (no cookies), so simply visiting "/" exercises the guest
// auto-provision path (app/guest-provision.tsx -> POST /api/session) for
// every run.
test("guest can auto-provision, select a symbol, trade, and see holdings update", async ({
  page,
}) => {
  await page.goto("/");
  // Generous timeout: this may be the first hit on /dashboard in the run,
  // and Next.js/Turbopack's first compile of a route can outlast the
  // default 5s assertion timeout.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  const watchlist = page.getByTestId("watchlist-widget");
  const holdings = page.getByTestId("holdings-widget");

  // New guests get a default watchlist (SPEC §6 / PLAN step 7), not an
  // empty one, so AAPL is already present without adding it first.
  const watchlistRow = watchlist.getByRole("row", { name: /AAPL/ });
  await expect(watchlistRow).toBeVisible();
  await watchlistRow.click();

  const buyButton = holdings.getByRole("button", { name: "Buy" });
  // canSubmitTrade() only requires a non-null client-side price, which
  // arrives via the WS snapshot almost immediately on subscribe -- this is
  // the real, observable "ready to trade" signal, not an arbitrary wait.
  await expect(buyButton).toBeEnabled({ timeout: 15_000 });

  // The server independently gates trades on a persisted SymbolState row
  // (PLAN step 32), written on the *first tick* after the engine starts
  // simulating this symbol -- fire-and-forget, so it can lag slightly
  // behind the client-visible snapshot price. Retry the buy rather than
  // hard-coding a delay, since the size of that lag isn't observable from
  // the UI.
  await expect(async () => {
    await buyButton.click();
    await expect(
      holdings.getByText("Live price unavailable — try again in a moment.")
    ).toHaveCount(0);
  }).toPass({ timeout: 15_000 });

  const holdingsRow = holdings.getByRole("row", { name: /AAPL/ });
  await expect(holdingsRow).toBeVisible();
  await expect(holdingsRow).toContainText("1"); // quantity bought

  // Unrealized P&L is only computed live for the selected symbol
  // (holdings-utils.ts computeUnrealizedPnL) -- confirm it's a real
  // computed value, not the "no live price yet" placeholder.
  await expect(holdingsRow.getByText("—", { exact: true })).toHaveCount(0);
});
