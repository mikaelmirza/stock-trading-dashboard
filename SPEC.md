# Stock Trading Dashboard — Project Spec

A portfolio piece: a full-stack, real-time-feeling stock trading dashboard with
a paper-trading simulator, built to demonstrate **full-stack systems thinking**
(a self-hosted WebSocket relay, auth, persistence) and **deep interactivity**
(cross-widget filtering/drill-down driven by a single source of truth for
"what symbol am I looking at").

> **Implementation note:** `AGENTS.md` in this repo states the local Next.js
> install has non-standard breaking changes from upstream. Before writing any
> Next.js-specific code (routing, API routes, middleware), read
> `node_modules/next/dist/docs/` and adjust the patterns below accordingly.

---

## 1. Goals & Non-Goals

**Goals**
- Prove you can own a whole system: DB schema, auth, a long-running relay
  process, and a polished frontend — not just UI.
- Make cross-widget interactivity the centerpiece: selecting a symbol in one
  widget instantly and consistently updates every other widget.
- Handle the unglamorous parts of real-time systems correctly and *visibly*:
  reconnects, trading halts, decimal-safe money, invalid trades.
- Zero-friction demo: a reviewer opens the link and is immediately trading,
  no signup wall.

**Non-goals (explicitly out of scope for v1)**
- Real brokerage integration or real money in any form.
- Multiple asset classes (crypto, options, forex) — stocks only.
- User-customizable widget layout (drag/resize) — layout is fixed.
- Price alerts / notifications.
- True live market data — all data is simulated (see §4).

---

## 2. Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Frontend framework | Next.js (App Router) + React + TypeScript | Existing skillset |
| UI components | MUI | Existing skillset; tables/cards/forms out of the box |
| Charting | **TradingView `lightweight-charts`** | Purpose-built for OHLC/candlestick data; strong portfolio signal ("same engine real trading platforms use") |
| Cross-widget UI state | **Zustand** | Single small store for `selectedSymbol`, `selectedTimeframe`, connection status — the backbone of the interactivity story |
| Server-state caching | **TanStack Query** | Caches REST calls (auth, trade history, seed data) separately from live WS state |
| Backend framework (API) | Next.js API routes | Auth, trade execution, watchlist CRUD |
| Realtime transport | **Plain Node process + `ws`** (separate from Next.js) | Long-running WS relay; kept out of Next.js entirely to avoid any risk from this repo's non-standard Next.js behavior |
| Database | PostgreSQL | Existing skillset |
| ORM | **Prisma** | Existing skillset preference; migrations + generated types |
| Auth | Custom email/password + guest sessions, httpOnly cookie session, short-lived signed JWT minted for WS handshake | See §6 |
| Testing | Vitest/Jest (unit + integration) + Playwright (E2E) | Full pyramid, per decision |
| Deployment | Single always-on host (Fly.io / Railway / Render) running **two processes**: the Next.js app and the WS relay | Avoids serverless WS limitations; keeps ops to one host |

---

## 3. Architecture

```
                    ┌─────────────────────────────┐
                    │   Host (Fly.io/Railway/etc)  │
                    │                              │
   Browser  ───────▶│  Next.js app (proc 1)        │
   (HTTPS)          │   - Pages/UI                 │
                    │   - API routes (auth, trades, │
                    │     watchlist CRUD)           │
                    │   - Prisma → Postgres         │
                    │   - Mints short-lived WS JWT  │
                    │                              │
   Browser  ───────▶│  WS Relay (proc 2, `ws`)      │
   (WSS)            │   - Verifies WS JWT           │
                    │   - Market Data Engine         │
                    │     (per-symbol simulators)    │
                    │   - Fans out ticks to all      │
                    │     subscribed clients         │
                    └─────────────────────────────┘
                              │
                              ▼
                         PostgreSQL
                (users, sessions, watchlists,
                 holdings, trades, seed price history)
```

Both processes share the Postgres instance and a shared JWT signing secret
(env var), but the relay never talks to Next.js directly — decoupled via the
DB and the signed token.

---

## 4. Simulated Market Data Engine

Real live market data feeds are either paid or too rate-limited for a
multi-user demo. Instead:

**Seeding (one-time, offline/build step):**
- Fetch real historical daily OHLC data for the ~15–25 curated symbols from
  **Alpha Vantage's free `TIME_SERIES_DAILY` endpoint** and store it in a
  `SeedPriceHistory` table. This is a one-time script run, not a runtime
  dependency — at one request per symbol, ~15–25 symbols comfortably fits
  within Alpha Vantage's free-tier daily rate limit (25 requests/day), even
  spread over a couple of days if needed. Requires an Alpha Vantage API key
  (free signup) stored as an env var for the seed script only.
- Derive per-symbol drift and volatility parameters from that real history
  (so AAPL "feels" less volatile than a smaller-cap name).

**Live simulation (runs inside the WS relay process):**
- Each subscribed symbol runs a **Geometric Brownian Motion** random walk
  seeded from its real drift/volatility, ticking every 250–1000ms (jittered)
  only while at least one client is subscribed to it (no wasted compute on
  unwatched symbols).
- **Anomaly events**: occasionally (low random probability per symbol per
  session) inject a sharp move that triggers a simulated **trading halt**:
  the symbol stops ticking, the UI shows a "Trading halted — volatility
  circuit breaker" state, and after a short pause ticking resumes at the new
  price level. This turns an otherwise-invisible edge case into something a
  reviewer actually sees happen live.
- Order book (bid/ask ladder) is derived per-tick from the current price plus
  a simulated spread/depth curve — not independently random, so price and
  book always stay consistent with each other.
- No market-hours simulation: ticks run continuously regardless of
  real-world time, so the demo always looks alive whenever someone visits.

---

## 5. WebSocket Relay

Plain Node process, no Next.js involvement, deployed as a second process on
the same host.

**Connection lifecycle:**
1. Browser loads the dashboard (authenticated via Next.js session cookie,
   see §6). Next.js mints a short-lived (~60s) signed JWT scoped to that
   user/session.
2. Browser opens a WebSocket to the relay, passing the JWT (e.g. as a query
   param or first message — not a cookie, since it's a separate origin/port
   conceptually).
3. Relay verifies the JWT signature against the shared secret (no DB
   round-trip). Rejects/closes the connection if invalid or expired.
4. Browser sends `subscribe: [symbols]` based on the user's watchlist; relay
   adds the connection to each symbol's fan-out set, starting that symbol's
   simulator if it isn't already running.
5. On disconnect, relay removes the connection from all symbol sets and stops
   simulating any symbol with zero remaining subscribers.

**Reconnect/resync (the concrete data-integrity demo):**
- Client-side: exponential backoff reconnect on drop, with a visible
  "Reconnecting…" banner instead of silently freezing on stale data.
- On reconnect, client resubscribes and the relay sends a fresh full snapshot
  for each symbol (current price + book) before resuming the tick stream —
  guarantees no duplicate or missing-tick artifacts after a reconnect, at the
  cost of not replaying exactly what was missed (acceptable for a demo; a
  "last known good" snapshot is what matters).

---

## 6. Auth & Sessions

**Guest-first, zero-friction access:**
- Visiting the dashboard with no session auto-provisions a guest account
  (`guest_xxxxx`) server-side and sets an httpOnly session cookie — no
  signup form in the way. Guest gets the standard $100k paper portfolio and a
  default watchlist.
- A persistent banner offers "Sign up to save this portfolio," which upgrades
  the guest account to a real email/password account in place (same user
  row, just adds credentials) rather than starting over.
- Real accounts: email + password, hashed with bcrypt, httpOnly session
  cookie (JWT-based).
- On each dashboard load, Next.js mints the short-lived WS JWT described in
  §5 from the current session.

**Guest cleanup:** guest accounts and their data are pruned after a period of
inactivity (e.g. 30 days) via a scheduled job — noted here as a requirement,
mechanism (cron on the host vs. a Postgres `pg_cron` job) left as an
implementation choice.

---

## 7. Data Model (Prisma, indicative)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String?  @unique   // null for guests
  passwordHash String?             // null for guests
  isGuest      Boolean  @default(true)
  cashBalance  Decimal  @default(100000)
  createdAt    DateTime @default(now())
  lastActiveAt DateTime @updatedAt
  watchlist    WatchlistItem[]
  holdings     Holding[]
  trades       Trade[]
}

model WatchlistItem {
  id       String @id @default(cuid())
  userId   String
  symbol   String
  addedAt  DateTime @default(now())
  user     User @relation(fields: [userId], references: [id])
  @@unique([userId, symbol])
}

model Holding {
  id           String  @id @default(cuid())
  userId       String
  symbol       String
  quantity     Int
  avgCostBasis Decimal
  user         User @relation(fields: [userId], references: [id])
  @@unique([userId, symbol])
}

model Trade {
  id        String   @id @default(cuid())
  userId    String
  symbol    String
  side      TradeSide // BUY | SELL
  quantity  Int
  price     Decimal
  executedAt DateTime @default(now())
  user      User @relation(fields: [userId], references: [id])
}

model SeedPriceHistory {
  id       String   @id @default(cuid())
  symbol   String
  date     DateTime
  open     Decimal
  high     Decimal
  low      Decimal
  close    Decimal
  volume   BigInt
  @@unique([symbol, date])
}
```

All money fields use Prisma's `Decimal` type end-to-end (never `Float`) —
prices, cash balance, cost basis, and P&L math all go through
decimal-safe arithmetic (e.g. `decimal.js`) on both client and server to
avoid floating-point rounding bugs in financial calculations.

---

## 8. Widgets & Interactivity

Fixed layout (no drag/resize in v1): watchlist rail on the left, price chart
center-top, order book center-bottom, holdings panel on the right.

**Single source of truth:** a Zustand store holds `selectedSymbol` and
`selectedTimeframe`. Every widget reads from it; only the watchlist writes
`selectedSymbol` (via row click) and only the chart writes `selectedTimeframe`
(via zoom/brush). This is the whole "deep interactivity" story — one click
updates chart, order book, and holdings-context simultaneously.

- **Watchlist** — table of the user's subscribed symbols with live price and
  daily change; add/remove symbols from the curated universe; click a row to
  set `selectedSymbol`.
- **Price chart** — candlestick chart (`lightweight-charts`) for
  `selectedSymbol`; zoom/brush sets `selectedTimeframe`, which only affects
  the chart's own view window (order book is inherently "now," not
  time-ranged).
- **Order book** — live bid/ask ladder for `selectedSymbol`; virtualized rows,
  updates batched and flushed on `requestAnimationFrame` rather than
  re-rendering per incoming message, to stay smooth under rapid ticks.
- **Holdings / paper trading** — shows current positions, unrealized P&L
  (recalculated live as ticks arrive), and a buy/sell form for
  `selectedSymbol`. Trade validation (can't sell more shares than owned,
  can't buy beyond cash balance) is enforced server-side in the trade API
  route, not just in the UI.

---

## 9. Data Integrity & Edge Cases

Explicitly designed for, not an afterthought:

- **Relay disconnect/reconnect** — visible "Reconnecting…" state, backoff,
  clean resnapshot on reconnect (§5).
- **Trading halts** — visible "Trading halted" state per symbol during
  simulated anomaly events (§4); buy/sell disabled for a halted symbol.
- **Decimal-safe money** — all price/cash/P&L arithmetic via `Decimal`,
  never native floats.
- **Trade validation** — server-side checks on every trade (sufficient cash
  for a buy, sufficient shares for a sell) — client-side checks are UX only,
  never trusted.
- **Empty states** — new user with an empty watchlist sees a clear
  "add your first symbol" prompt, not a blank widget.
- **Loading states** — initial historical chart load and WS connect are
  distinct loading indicators (don't conflate "waiting for history" with
  "waiting for live connection").

---

## 10. Testing Strategy

Full pyramid, prioritized toward the parts that are actually tricky:

- **Unit** — P&L/cost-basis math, order book diff/merge logic, GBM tick
  generator determinism (given a seed, output is reproducible), reconnect
  backoff timing logic.
- **Integration** — Next.js API routes (auth flows, trade execution
  including rejection paths) against a real test Postgres instance; relay
  message handling (subscribe/unsubscribe/snapshot-on-reconnect) against a
  mock client.
- **E2E (Playwright)** — guest session auto-provision → select a symbol →
  place a trade → see holdings/P&L update live; simulate a dropped WS
  connection and verify the UI reconnects and resyncs without leaving stale
  data on screen.

---

## 11. Deployment

- Single host (Fly.io, Railway, or Render — final pick left open, all three
  fit) running two always-on processes: the Next.js app and the WS relay.
- Shared env: `DATABASE_URL`, `WS_JWT_SECRET`, `SESSION_SECRET`.
- Migrations via Prisma Migrate, run as a deploy step.

---

## 12. Milestones (a few weeks, part-time)

1. **Foundation** — Prisma schema + migrations, guest/auth flow, seed data
   fetch + storage script.
2. **Relay core** — WS relay process, GBM tick engine, subscribe/fan-out,
   JWT handshake auth.
3. **Core widgets** — watchlist + price chart wired to the Zustand store and
   live ticks.
4. **Trading loop** — holdings widget + trade API with server-side
   validation and decimal-safe P&L.
5. **Order book** — virtualized, batched-update depth ladder.
6. **Resilience pass** — reconnect/resync, trading-halt anomaly events, empty
   /loading/error states.
7. **Testing pass** — unit + integration + E2E per §10.
8. **Deploy** — two-process host setup, env wiring, smoke test.

---

## 13. Future Work (explicitly out of scope for v1)

- Price alerts / notifications.
- Drag-and-drop customizable widget layout.
- Additional asset classes (crypto, options).
- Larger symbol universe with search/filter.
- Real market-hours simulation (open/closed/pre-market/after-hours states).
- News/sentiment feed widget.
