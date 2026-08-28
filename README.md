# Stock Trading Dashboard

A full-stack, real-time-feeling paper-trading dashboard. Open the link and
you're immediately trading — no signup wall — against a simulated market with
live ticks, a candlestick chart, a depth-of-book ladder, live P&L, and
server-validated order execution.

- **Live app:** https://stock-trading-app-bsii.onrender.com
- **Live relay:** `wss://stock-trading-relay.onrender.com`
- **Source:** https://github.com/mikaelmirza/stock-trading-dashboard

It's a portfolio piece, built to demonstrate two things deliberately:

1. **Full-stack systems ownership** — a database schema, custom auth with
   guest sessions, a long-running WebSocket relay process that's *not* part of
   the web framework, and a deploy story that runs both processes.
2. **Deep cross-widget interactivity** — one click on a watchlist row
   re-points the chart, the order book, and the holdings panel simultaneously,
   because they all read from a single source of truth for "what symbol am I
   looking at."

The full product spec is in [SPEC.md](SPEC.md); the step-by-step build and
verification plan is in [PLAN.md](PLAN.md).

---

## Table of contents

- [Using the app](#using-the-app)
- [Architecture at a glance](#architecture-at-a-glance)
- [Tech stack and why](#tech-stack-and-why)
- [Components](#components)
  - [1. The Next.js app](#1-the-nextjs-app-process-1)
  - [2. The WebSocket relay](#2-the-websocket-relay-process-2)
  - [3. The database](#3-the-database)
  - [4. The simulated market data engine](#4-the-simulated-market-data-engine)
  - [5. The frontend](#5-the-frontend)
- [Key design decisions](#key-design-decisions)
- [Data integrity and edge cases](#data-integrity-and-edge-cases)
- [Testing](#testing)
- [Local development](#local-development)
- [Deployment](#deployment)
- [Known trade-offs](#known-trade-offs)
- [A note on this repo's Next.js](#a-note-on-this-repos-nextjs)

---

## Using the app

Open **https://stock-trading-app-bsii.onrender.com** in a browser. That's the
whole setup — there's no account to create.

> **First load may take ~20–30 seconds.** The app and the market relay both
> run on a free hosting tier that sleeps after 15 minutes of inactivity, so
> the first visitor wakes them. Once warm it's instant. If the chart or order
> book sits empty for a while on a cold start, give it a moment or refresh
> once.

### Getting started

1. **You're dropped straight onto the dashboard** as a guest, with a
   **$100,000 paper cash balance** and a starter watchlist
   (AAPL, AMZN, GOOGL, MSFT, NVDA, TSLA). Nothing you do here is real money or
   a real order.
2. **Pick a symbol** — click any row in the **Watchlist** (left). The
   **chart**, **order book**, and **holdings/trade panel** all switch to that
   symbol at once. This is the core of the app: one click drives every widget.
3. **Watch it move.** Prices tick every fraction of a second. The connection
   status shows at the top; if it ever says "Reconnecting…", the app is
   re-syncing and will recover on its own — it won't show you a frozen price
   as if it were live.

### Placing a trade

1. Select the symbol you want in the watchlist.
2. In the **Holdings** panel (right), use the **buy / sell form**: enter a
   share quantity and submit.
3. A **BUY** must fit your cash balance; a **SELL** can't exceed shares you
   own. The server enforces both — an invalid trade is rejected with a
   reason, not silently swallowed.
4. On success, your **cash balance**, **position** (quantity + average cost
   basis), and **unrealized P&L** update immediately, and P&L keeps moving
   live as the price ticks.

### Managing your watchlist

- **Add a symbol:** use the add control in the Watchlist. Only the ~20
  curated symbols are accepted (AAPL, AMD, AMZN, BA, CSCO, DIS, GOOGL, INTC,
  JPM, KO, META, MSFT, NFLX, NVDA, ORCL, PFE, TSLA, V, WMT, XOM).
- **Remove a symbol:** use the remove control on its row.
- An empty watchlist shows an "add your first symbol" prompt rather than a
  blank panel.

### Trading halts (you'll see this happen)

Every so often a symbol hits a simulated **volatility circuit breaker**: a
sharp price move, then the symbol freezes for a few seconds and the trade
form disables for it, showing a "Trading halted" state. It resumes on its own
at the new price level. This is intentional — it's the app demonstrating that
it handles the messy parts of real-time markets visibly.

### Saving your portfolio (optional)

As a guest, your portfolio persists as long as you keep the session cookie
and stay active — **guest accounts inactive for 30+ days are pruned.** To keep
it permanently, use **"Sign up to save this portfolio"**: it adds an
email + password to your *existing* account in place — same cash, same
positions, same history — and you can log back in later from any device.
Logging out clears the session.

### Running it yourself

If you'd rather run the whole stack locally instead of using the hosted demo,
see [Local development](#local-development).

---

## Architecture at a glance

```
                        ┌─────────────────────────────────────┐
   Browser ── HTTPS ───▶ │  Next.js app (process 1)            │
                        │   • Pages / UI (App Router)          │
                        │   • API routes: auth, trades,        │
                        │     watchlist, holdings, seed data   │
                        │   • Prisma → Postgres                │
                        │   • Mints a ~60s WS handshake JWT    │
                        └──────────────┬──────────────────────┘
                                       │  shared: Postgres +
                                       │  WS_JWT_SECRET (env)
                        ┌──────────────┴──────────────────────┐
   Browser ── WSS  ───▶ │  WS relay (process 2, plain `ws`)   │
                        │   • Verifies the handshake JWT       │
                        │   • Per-symbol GBM price simulators  │
                        │   • Trading-halt anomaly events      │
                        │   • Fans ticks out to subscribers    │
                        │   • Writes authoritative price/halt  │
                        │     to Postgres (SymbolState)        │
                        └──────────────┬──────────────────────┘
                                       ▼
                                  PostgreSQL
                     users · watchlists · holdings · trades
                     seed price history · symbol state
```

**The two processes never call each other.** They're decoupled through two
shared things only: the Postgres instance and a JWT signing secret in an
environment variable. This is the central architectural choice — see
[Key design decisions](#key-design-decisions).

---

## Tech stack and why

| Concern | Choice | Why this one |
|---|---|---|
| Web framework | **Next.js 16 (App Router) + React 19 + TypeScript** | One framework for UI and the REST API; App Router server components keep auth checks on the server. (This repo runs a non-standard Next.js 16 — see the [note below](#a-note-on-this-repos-nextjs).) |
| UI components | **MUI 9** (`@mui/material`) | Tables, cards, forms, theming out of the box — the dashboard is mostly data-dense tables and a trade form, not bespoke visuals. |
| Charting | **TradingView `lightweight-charts` 5** | Purpose-built for OHLC/candlestick data. It's the same rendering engine real trading front-ends use, which is the right signal for this kind of project. |
| Cross-widget UI state | **Zustand 5** | One tiny store holding `selectedSymbol`, `selectedTimeframe`, and connection status. This store *is* the interactivity story; a full state library would be overkill. |
| Server-state cache | **TanStack Query 5** | Caches REST responses (watchlist, trade history, seed candles) with dedup and background refetch — kept deliberately separate from the live WS state, which is push-based and has different freshness semantics. |
| Realtime transport | **Plain Node process + `ws` 8** | A long-running WebSocket server. Kept entirely outside Next.js — serverless/route-handler WebSockets close on timeout, and this repo's Next.js is explicitly non-standard, so the relay is insulated from it. |
| Database | **PostgreSQL** | Relational data (users → holdings → trades), decimal money columns, transactional trade execution. |
| ORM | **Prisma 7** (`@prisma/client` + `@prisma/adapter-pg`) | Typed queries, migrations. Prisma 7 needs an explicit `pg` driver adapter — configured in `app/lib/db.ts`. |
| Money math | **`decimal.js`** | Every price, cash balance, cost basis, and P&L figure is decimal-safe end to end. Never a JS `number` for money. |
| Auth | **Custom** — `bcryptjs` + `jose` (JWT), httpOnly cookie | Guest-first sessions with in-place upgrade to email/password. `bcryptjs` (pure JS, no native build step); `jose` works in both the Next.js runtime and plain Node (the relay). |
| Validation | **`zod` 4** | Every route handler validates its request body/params before touching the DB. |
| Tests | **Vitest 4** (unit + integration) + **Playwright** (E2E) | Full pyramid; heaviest coverage on the tricky bits (trade math, GBM determinism, reconnect logic). |
| Deploy | **Render** — two web services + one Postgres + one cron job | One host, two always-on processes, matching the architecture. (`fly.toml` is also in the repo as an earlier target — superseded.) |

---

## Components

### 1. The Next.js app (process 1)

The web UI plus a small REST API. Everything user-specific and
security-sensitive lives here.

#### Auth & session layer

| File | Role |
|---|---|
| `app/lib/session.ts` | `encrypt` / `decrypt` a stateless JWT session token (HS256 via `jose`), and `createSession` / `deleteSession` / `getSessionCookie` for the httpOnly cookie. `decrypt` never throws — a missing/tampered/expired token is just "no session." |
| `app/lib/dal.ts` | The **Data Access Layer**. `verifySession()` reads the cookie, verifies the JWT, and confirms the user row still exists (a pruned guest fails here). `getUser()` builds on it. Both wrapped in React `cache()` so multiple components in one request share one verify. `verifySession()` also bumps `User.lastActiveAt`, but **throttled** to once an hour — it's the clock guest-cleanup runs off, and writing it on every request would be wasteful. |
| `app/lib/db.ts` | Prisma client singleton (survives dev hot-reload without exhausting Postgres connections) with the explicit `PrismaPg` adapter that Prisma 7 requires. |
| `proxy.ts` (project root) | Next.js 16's renamed middleware. Does an **optimistic**, cookie-only redirect for `/dashboard` — no DB hit, because it runs on every request including prefetches. The real DB check is defense-in-depth in `app/dashboard/layout.tsx`. |

Sessions are **pure stateless JWT** — no `Session` table, no Redis. Every
trade is re-validated server-side per request regardless of session model, and
nothing in the product needs a revocation kill-switch, so a stateful session
store would add a service for no feature. (This trade-off is written up in
PLAN.md §6.)

#### API routes (`app/api/**/route.ts`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `session` | POST | none | Zero-friction guest bootstrap: creates an `isGuest` user with the $100k balance **and a default watchlist**, sets the cookie. |
| `auth/signup` | POST | session | Upgrades the current guest row **in place** (same `User.id`) — adds email + `bcryptjs` hash, flips `isGuest` false. `409` on duplicate email. |
| `auth/login` | POST | none | Email/password → session cookie, or `401`. |
| `auth/logout` | POST | session | Clears the cookie. |
| `ws-token` | GET | session | Mints the short-lived (~60s) handshake JWT the browser hands to the relay. Signed with `WS_JWT_SECRET`, verifiable with no DB round-trip. |
| `watchlist` | GET / POST | session | List / add. `422` if the symbol isn't in the curated universe, `409` if already present. |
| `watchlist/[symbol]` | DELETE | session | Remove. |
| `trades` | GET / POST | session | History / **execute**. See below. |
| `holdings` | GET | session | Current positions. |
| `symbols` | GET | none | The curated symbol universe (a static constant, not a DB table). |
| `seed-history/[symbol]` | GET | none | Historical daily OHLC for the chart's initial paint, before live ticks arrive. |

**Trade execution** (`app/api/trades/route.ts` + `trade-math.ts`) is the
heart of the server. On `POST`:

1. Validate the body with `zod`.
2. Load the user, any existing holding, and the symbol's `SymbolState` row
   (the authoritative price/halt status written by the relay) in one
   `Promise.all`.
3. Run `validateTrade()` — a **pure, synchronous, exhaustively unit-tested**
   function that returns exactly one rejection reason or `null`:
   `invalid_quantity`, `market_data_unavailable` (stale **or** missing
   `SymbolState` — see the [staleness guard](#the-staleness-guard)),
   `symbol_halted`, `insufficient_cash`, `insufficient_shares`.
4. Compute the new cash balance and the new holding (weighted-average cost
   basis on buys; basis unchanged on sells, realized P&L reported) with
   `decimal.js`.
5. Persist trade + user + holding in a single `db.$transaction`. A fully
   sold-out position deletes the `Holding` row rather than leaving a zero.

Client-side checks in the trade form are UX only — the server is the sole
authority.

### 2. The WebSocket relay (process 2)

A standalone Node process (`relay/`, run with `tsx`). No Next.js imports for
anything HTTP; it shares only the Prisma client and the JWT secret.

| File | Role |
|---|---|
| `relay/index.ts` | `ws` server bootstrap. On connect: reads `?token=`, verifies it, wires `subscribe`/`unsubscribe` messages to the connection manager, cleans up on close. Binds `$PORT` in production. |
| `relay/jwt.ts` | Verifies the handshake JWT against `WS_JWT_SECRET`. No DB. |
| `relay/market-engine.ts` | **One symbol's price simulator.** A Geometric Brownian Motion random walk seeded from that symbol's *real* historical drift & volatility (so AAPL feels calmer than a small-cap). Owns pricing/halt **decisions**; the caller owns **timing** — `tick(now)` takes the clock as a parameter so tests can drive it deterministically. Includes a seeded PRNG (`mulberry32`) so a given seed reproduces an exact tick sequence. |
| `relay/order-book.ts` | Derives a 5-level bid/ask ladder from the current price plus a fixed spread/depth curve — **not independently random**, so the book and the price can never disagree. |
| `relay/connection-manager.ts` | Subscribe/unsubscribe fan-out and the per-symbol simulation lifecycle. A symbol only ticks while ≥1 client is subscribed; the last unsubscribe stops it — unwatched symbols cost nothing. Also owns the relay's side of the `SymbolState` bridge: throttled writes (~1/s per symbol), **unthrottled** writes on halt/resume transitions, a startup **continuity read** (resume from the last persisted price, not the seed price, so a relay restart isn't a visible price jump), and **fire-and-forget** persistence (a slow/down DB logs and continues, never stalls tick delivery). |

**Wire protocol** (server → client): `snapshot` (on subscribe/reconnect —
carries `isHalted`, because `halt`/`resume` only fire on the *transition*),
`tick`, `halt`, `resume`.

### 3. The database

PostgreSQL via Prisma (`prisma/schema.prisma`). Money columns are pinned to
`Decimal(14,4)` so Postgres doesn't pick an unpredictable precision.

| Model | Notes |
|---|---|
| `User` | `email`/`passwordHash` null for guests. `cashBalance` defaults to 100000. `lastActiveAt` (`@updatedAt`) is the guest-cleanup clock. |
| `WatchlistItem` | `@@unique([userId, symbol])`. Cascade-deletes with the user. |
| `Holding` | `quantity` + `avgCostBasis`. `@@unique([userId, symbol])`. Cascades. |
| `Trade` | Immutable ledger row per execution. Indexed `[userId, executedAt]`. Cascades. |
| `SeedPriceHistory` | Real Alpha Vantage daily OHLC, loaded once. Feeds both the chart's initial paint and the GBM drift/volatility derivation. `@@unique([symbol, date])` makes re-seeding idempotent. |
| `SymbolState` | **The bridge table.** `symbol` PK, `lastPrice`, `isHalted`, `updatedAt`. The relay is the *only* writer; the trade API is the *only* reader. This is how the Next.js process learns the authoritative live price without an inter-process HTTP call — the two processes already share Postgres, so this reuses it. |

Migrations live in `prisma/migrations/`. The `guest_cleanup_cron` migration
is intentionally a **no-op** (`SELECT 1;`) — it originally created a `pg_cron`
job, but Render's managed Postgres doesn't offer `pg_cron`, so cleanup moved
to a scheduled script (`scripts/prune-inactive-guests.ts`). The migration was
kept as a no-op rather than deleted so applied history stays consistent.

### 4. The simulated market data engine

Real live feeds are paid or too rate-limited for a multi-user demo, so the
market is simulated — but seeded from real data.

**Seeding (one-time, `scripts/seed-price-history.ts`, `npm run db:seed`):**
fetches real historical daily OHLC for the ~20 curated symbols from Alpha
Vantage's free `TIME_SERIES_DAILY` endpoint (one request per symbol, well
within the 25/day free limit) into `SeedPriceHistory`. Pure response parsing
is split out (`parseSeriesResponse`) and unit-tested without a network call.

**Live simulation (inside the relay):**
- Each subscribed symbol runs a **GBM random walk** using drift & volatility
  computed from the mean/stddev of its real daily log returns.
- Ticks every 250–1000 ms (jittered), only while subscribed.
- **Trading-halt anomaly events**: a low per-tick probability injects a sharp
  ±5% move and halts the symbol — ticking stops, the UI shows a "volatility
  circuit breaker" state, the trade form disables — then resumes at the new
  level after a short pause. This turns an invisible edge case into something
  a reviewer actually watches happen.
- The order book is derived per-tick from the price, never independently
  random.
- No market-hours logic — it's always live so the demo always looks alive.

### 5. The frontend

#### State: two stores, on purpose

- **`app/store/dashboard-store.ts` (Zustand)** — `selectedSymbol`,
  `selectedTimeframe`, `connectionStatus`. Only the watchlist writes
  `selectedSymbol` (row click); only the chart writes `selectedTimeframe`
  (zoom/brush). Every widget just reads. This is the entire "deep
  interactivity" mechanism — one click, one store update, three widgets
  re-point.
- **TanStack Query** — REST responses (watchlist, trades, seed candles).
  Push-based live data deliberately does *not* go here.

#### The live-data pipeline

| File | Role |
|---|---|
| `app/hooks/market-stream.ts` | `MarketStreamClient` — framework-agnostic class owning the relay socket: handshake-token fetch per (re)connect, **exponential-backoff reconnect**, and full resubscribe on reconnect so the relay resends a fresh snapshot per symbol (no duplicate/missing-tick artifacts across a drop). The socket is behind an injectable `SocketLike` interface so it's unit-tested with no browser. |
| `app/hooks/useWebSocket.ts` | React lifecycle wrapper: one connection for the whole dashboard, subscribes the **entire watchlist** up front (so switching selection never waits on a subscribe), mirrors status into the Zustand store. |
| `app/hooks/useMarketData.ts` | Filters the multiplexed stream down to `selectedSymbol` and exposes its `price` / `book` / `isHalted`. Reads the external client via `useSyncExternalStore` (with a `getServerSnapshot` returning empty — required because these `"use client"` components are still server-rendered). |

#### The four widgets (`app/components/`, assembled in `app/dashboard/page.tsx`)

- **Watchlist** — the user's symbols with live price and daily change;
  add/remove from the curated universe; **the only writer of
  `selectedSymbol`**.
- **Price chart** — `lightweight-charts` candlesticks for the selected
  symbol. Historical paint from `seed-history`, then live ticks append.
  Switching symbols fully replaces the series — no stale bleed.
- **Order book** — live bid/ask depth ladder. Updates are **coalesced to one
  flush per `requestAnimationFrame`** (`FrameBatcher`) instead of
  re-rendering per message, so it stays smooth under rapid ticks. Virtualized
  rows.
- **Holdings / paper trading** — positions, **unrealized P&L recomputed live**
  from the tick stream (decimal-safe), and a buy/sell form for the selected
  symbol. The form disables for a halted symbol, but the server still
  re-checks everything.

Plus **`ConnectionBanner`** — a visible "Reconnecting…" state driven by
`connectionStatus`, so a dropped connection never silently freezes on stale
data.

#### Zero-friction entry

`app/page.tsx` (server component) checks the session: authenticated visitors
redirect straight to `/dashboard`; new visitors get `GuestProvision`, a tiny
client component that `POST`s `/api/session` (the one place allowed to set the
cookie) and then lands on `/dashboard`. No form, ever.

---

## Key design decisions

**The relay is a separate process, not a route handler.** WebSockets in
serverless/route-handler environments close on timeout or after the response.
Beyond that, this repo's Next.js is explicitly non-standard (see below), so
keeping the long-running realtime code in plain Node insulates it entirely.
The cost — a second process to deploy and a cross-process state-sharing
problem — is paid deliberately.

**The two processes share only Postgres + a secret.** No RPC, no message bus,
no shared memory. The relay writes authoritative price/halt status to the
`SymbolState` table; the trade API reads it. Adding an internal HTTP endpoint
on the relay was the alternative — rejected because it introduces a new
failure mode (relay unreachable at trade time) that the DB approach handles
naturally via the staleness guard.

**The staleness guard.** Because the trade API prices trades from
`SymbolState` (up to ~1s behind the tick the user just saw — an
accepted/documented simplification), it must not trade against an
arbitrarily-old frozen price if the relay is down. So: reject with
`market_data_unavailable` if `SymbolState.updatedAt` is older than 10s, and
treat a *missing* row identically (covers the race where a symbol was just
subscribed and its first write hasn't landed).

**Stateless JWT sessions, no session store.** Trades are re-validated
server-side every time regardless; nothing needs a revocation kill-switch. A
Redis/`Session`-table hybrid was considered and set aside — it'd be a third
stateful service with no feature driving it.

**Guest-first auth with in-place upgrade.** Signup mutates the existing guest
`User` row (same `id`, same portfolio) instead of creating a new account, so
"sign up to save this" genuinely saves what you were just doing.

**Decimal everywhere for money.** `Decimal(14,4)` columns; `decimal.js` on
both client and server; money crosses the wire as strings, never JSON
numbers, to avoid float precision loss in transit.

**`requestAnimationFrame`-batched order book.** Rapid ticks would otherwise
cause a re-render per message. `FrameBatcher` keeps only the latest value per
frame.

---

## Data integrity and edge cases

These were designed for, not bolted on:

- **Reconnect/resync** — backoff reconnect, visible "Reconnecting…" banner,
  fresh full snapshot per symbol on reconnect. No stale price is ever shown
  as live.
- **Trading halts** — visible per-symbol state during anomaly events; buy/sell
  disabled (server-enforced).
- **Relay restart continuity** — a symbol resumes from its last persisted
  price, not a jump back to the seed price.
- **Decimal-safe money** — no native floats in any price/cash/P&L path.
- **Server-side trade validation** — every rejection path is a pure,
  unit-tested function.
- **Empty vs. loading states** — a new guest sees "add your first symbol," not
  a blank widget; "waiting for history" and "waiting for live connection" are
  visibly distinct.

---

## Testing

Full pyramid, weighted toward the genuinely tricky parts.

- **Unit / integration (Vitest):** ~160 tests. Trade math & every rejection
  path, order-book derivation, GBM determinism, reconnect/backoff logic,
  connection-manager fan-out, DAL session logic, API routes against Postgres,
  relay message handling against mock sockets.
- **E2E (Playwright, `e2e/`):** guest-provision → select symbol → trade → see
  holdings/P&L update live; and a dropped-WS-connection scenario using
  `page.routeWebSocket` to proxy a real relay connection and force-close it
  under test control.

```bash
npm test          # vitest run
npm run test:e2e  # playwright (auto-starts next dev + relay; Postgres must be up)
```

---

## Local development

**Prerequisites:** Node (see `.nvmrc`), a local PostgreSQL, an Alpha Vantage
free API key (only for seeding).

```bash
# 1. Install
npm install

# 2. Env
cp .env.example .env        # then fill in DATABASE_URL, SESSION_SECRET,
                            # WS_JWT_SECRET, ALPHA_VANTAGE_API_KEY

# 3. Database
npx prisma migrate deploy   # apply migrations
npx prisma generate         # generate the client (output: app/generated/prisma)

# 4. Seed real historical prices (one time)
npm run db:seed

# 5. Run both processes (separate terminals)
npm run dev                 # Next.js app on :3000
npm run relay:dev           # WS relay on :8080 (tsx watch)
```

Open http://localhost:3000 — you'll be auto-provisioned as a guest and land
on the dashboard.

---

## Deployment

Deployed on **Render** via `render.yaml` (a Render Blueprint), mirroring the
two-process architecture:

| Service | Type | Notes |
|---|---|---|
| `stock-trading-app` | web | `prisma migrate deploy` at boot, then `next start`. |
| `stock-trading-relay` | web | `npm run relay:start`. |
| `stock-trading-guest-cleanup` | cron | Daily `prune-inactive-guests.ts` (Render has no `pg_cron`). |
| `stock-trading-db` | Postgres | Shared by all three. |

`WS_JWT_SECRET` is a shared env-var group; `DATABASE_URL` comes from the
managed DB; `SESSION_SECRET` is generated. `NEXT_PUBLIC_RELAY_URL` is a
build-time public var that needs the relay's real hostname, so it's a
two-phase deploy: ship the relay, read its URL, set the var, redeploy the app.

`fly.toml` is also in the repo — an earlier Fly.io target (two process groups
+ a self-managed Postgres Machine with `pg_cron`), superseded by Render but
left as a reference.

Three bugs surfaced *only* against a real production environment and are fixed
on `main`: a Prisma CLI banner line captured into the init migration SQL; the
relay/cron `buildCommand` not running `prisma generate`; and
`useSyncExternalStore` missing its `getServerSnapshot` (500'd every
server-rendered `/dashboard`). See git history for details.

---

## Known trade-offs

Deliberate, documented, **not** bugs:

- **Free-tier cold starts.** Both Render web services sleep after 15 min idle;
  a cold relay took ~21s to wake. At odds with the "immediately trading"
  goal — the price of a $0 hosting tier. Fixable by paying for always-on.
- **Free Postgres expiry.** Render's free Postgres expires 30 days after
  creation (14-day grace). Needs manual renewal; nothing automates it.
- **Trade price is up to ~1s stale.** Trades execute at
  `SymbolState.lastPrice`, which lags the on-screen tick by up to the ~1s
  write throttle. Tightening this further wasn't worth the complexity; the
  staleness guard bounds the worst case.
- **Tests run against the dev DB**, not a separate disposable test database.

---

## A note on this repo's Next.js

Per `AGENTS.md`, this repo's Next.js 16 install has real behavioral
differences from upstream — most relevantly, **middleware is renamed to
"Proxy"** (`proxy.ts` at the project root, exporting `proxy()`). `PLAN.md §0`
records the deltas that actually affected the build, and also flags a
prompt-injection pattern found in the vendored docs (an HTML comment
addressed "to the AI agent" instructing that routes must export an
experimental API) that was deliberately **not** followed. Cache Components
(`cacheComponents`) is left off — nearly every surface here is
per-user/per-request, so there's little to prerender.
