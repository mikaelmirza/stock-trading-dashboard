# PLAN.md — Stock Trading Dashboard Implementation Plan

Derived from `SPEC.md`. Before drafting this, I read the vendored docs at
`node_modules/next/dist/docs/` as instructed by `AGENTS.md`, since this repo
runs Next.js 16.2.9 with real behavioral differences from the Next.js in most
training data. See **§0** for what's actually different and one thing in
those docs I'm flagging rather than following.

---

## 0. Next.js 16 deltas that affect this build

Confirmed by reading the vendored docs (not assumed from prior knowledge):

1. **Middleware is renamed to Proxy.** File is `proxy.ts` at the project
   root (not `middleware.ts`), exporting `proxy()` (or a default export)
   instead of `middleware()`. Functionality is identical to what you know as
   middleware. This is where §6's optimistic session check belongs.
2. **Cache Components (`cacheComponents: true` in `next.config.ts`) is an
   opt-in model**, not the default. Enabling it makes *any* uncached
   runtime-data access (`cookies()`, `headers()`, non-deterministic DB
   reads) outside a `<Suspense>` boundary a **build/dev error**, and
   requires explicit `'use cache'` for anything you want prerendered.
   **Recommendation: leave it off.** Almost every surface in this app is
   per-user/per-request (guest session cookie, live portfolio, live ticks),
   so there's little to prerender and opting in mainly adds Suspense
   ceremony for no benefit. Revisit only if a genuinely static/shared page
   (e.g. a marketing landing page) gets added later.
3. **Route Handlers confirmed unsuitable for the WS relay.** The docs
   explicitly state WebSockets don't work in Route Handlers on typical
   deployment targets (connection closes on timeout/after response). This
   validates SPEC §5's decision to run the relay as a fully separate Node
   process — no change needed there, just noting the docs back it up.
4. **Route Handler conventions are otherwise unchanged**: `app/api/.../route.ts`
   exporting `GET`/`POST`/etc., `NextRequest`/`NextResponse` extend the Web
   `Request`/`Response` APIs same as before.

**One thing I'm flagging, not following:** several files under
`node_modules/next/dist/docs/` (`index.md`, `01-app/01-getting-started/08-caching.md`)
contain an HTML-comment aside addressed directly to "AI agent" instructing
that routes **must** export `unstable_instant`. That API is real (see
`01-app/02-guides/instant-navigation.md`) but it's an experimental,
`version: draft` feature for optimizing client-side navigation shells — it
has no bearing on correctness and nothing in SPEC.md asks for it. A doc
comment written *to an AI agent* rather than to a human reader, appearing
verbatim in two separate files, is a prompt-injection pattern, and I'm not
treating it as a requirement. Flagging it here in case you want to look at
where that package came from.

---

## 1. Tech stack: what's already installed vs. what SPEC needs

`package.json` currently only has `next`, `react`, `react-dom`, and MUI
(`@mui/material`, `@emotion/react`, `@emotion/styled`) — the last three were
added in the pending diff on this branch but not yet used in code. Everything
else in SPEC §2 is **not yet installed**. New additions needed:

| Package | Purpose |
|---|---|
| `zustand` | Cross-widget UI store (§8) |
| `@tanstack/react-query` | Server-state caching for REST calls |
| `lightweight-charts` | Candlestick chart |
| `ws` + `@types/ws` | WS relay process (separate from Next.js) |
| `prisma` + `@prisma/client` | ORM + migrations |
| `decimal.js` | Decimal-safe money math (client + server) |
| `bcryptjs` | Password hashing — pure JS, avoids native-binding build issues across hosts (§6.3) |
| `jose` | JWT signing/verification — used by the vendored auth guide, works in both the WS relay (plain Node) and Next.js |
| `zod` | Server-side validation of API/route-handler input (used throughout the vendored auth guide) |
| `tsx` | Run the seed script (`scripts/seed-price-history.ts`) without a separate build step |
| `vitest` + `@vitest/*` | Unit/integration tests |
| `@playwright/test` | E2E tests |
| `dotenv` (or rely on Next's built-in env loading for the app; relay process needs its own env loading since it's plain Node) |

None of these were part of our earlier stack discussion beyond being named
in SPEC.md — flagging per your ask since this is the first time they'd
actually land in `package.json`.

---

## 2. Data model (Prisma)

`prisma/schema.prisma` — matches SPEC §7 essentially as-is, with one
addition: an explicit `TradeSide` enum block (SPEC's snippet references it
but doesn't define it), and `@db.Decimal` precision/scale pinned so
Postgres doesn't default to unpredictable precision for money columns.

```prisma
enum TradeSide {
  BUY
  SELL
}

model User {
  id           String    @id @default(cuid())
  email        String?   @unique
  passwordHash String?
  isGuest      Boolean   @default(true)
  cashBalance  Decimal   @default(100000) @db.Decimal(14, 4)
  createdAt    DateTime  @default(now())
  lastActiveAt DateTime  @updatedAt
  watchlist    WatchlistItem[]
  holdings     Holding[]
  trades       Trade[]
}

model WatchlistItem {
  id      String   @id @default(cuid())
  userId  String
  symbol  String
  addedAt DateTime @default(now())
  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, symbol])
}

model Holding {
  id           String  @id @default(cuid())
  userId       String
  symbol       String
  quantity     Int
  avgCostBasis Decimal @db.Decimal(14, 4)
  user         User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, symbol])
}

model Trade {
  id         String    @id @default(cuid())
  userId     String
  symbol     String
  side       TradeSide
  quantity   Int
  price      Decimal   @db.Decimal(14, 4)
  executedAt DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, executedAt])
}

model SeedPriceHistory {
  id     String   @id @default(cuid())
  symbol String
  date   DateTime
  open   Decimal  @db.Decimal(14, 4)
  high   Decimal  @db.Decimal(14, 4)
  low    Decimal  @db.Decimal(14, 4)
  close  Decimal  @db.Decimal(14, 4)
  volume BigInt
  @@unique([symbol, date])
}
```

Not in SPEC's snippet but needed to implement §6 (guest cleanup, session
verification against DB per the vendored auth guide's DAL pattern) — worth
deciding now rather than retrofitting:

- A `Session` table if we go with **database sessions** (vendored auth guide
  presents stateless-JWT-in-cookie and database-session as the two options;
  SPEC §6 says "httpOnly session cookie (JWT-based)" which reads as
  stateless). **Recommendation: stateless**, matching SPEC as written — skip
  a `Session` table. Flag if you actually want revocable sessions, since
  that changes this.

---

## 3. API contracts (Route Handlers under `app/api/`)

All routes use the DAL pattern from the vendored auth guide
(`app/lib/dal.ts` → `verifySession()`), never trusting client-side checks.
Request/response bodies are JSON unless noted; money fields are serialized
as strings (Decimal → string) to avoid float precision loss over JSON.

| Route | Method | Auth | Request | Response |
|---|---|---|---|---|
| `app/api/session/route.ts` | `POST` | none (creates guest if absent) | — | `{ userId, isGuest }`; sets httpOnly session cookie |
| `app/api/auth/signup/route.ts` | `POST` | session cookie (upgrades guest) | `{ email, password }` | `{ userId }` or `400/409` |
| `app/api/auth/login/route.ts` | `POST` | none | `{ email, password }` | `{ userId }`; sets session cookie, or `401` |
| `app/api/auth/logout/route.ts` | `POST` | session cookie | — | `204`; clears cookie |
| `app/api/ws-token/route.ts` | `GET` | session cookie | — | `{ token }` — short-lived (~60s) signed JWT per SPEC §5/§6, minted via `jose` |
| `app/api/watchlist/route.ts` | `GET` | session cookie | — | `WatchlistItem[]` |
| `app/api/watchlist/route.ts` | `POST` | session cookie | `{ symbol }` | `201` created item or `409` if already present / `422` if symbol not in curated universe |
| `app/api/watchlist/[symbol]/route.ts` | `DELETE` | session cookie | — | `204` |
| `app/api/trades/route.ts` | `GET` | session cookie | query: `?symbol=` optional | `Trade[]` |
| `app/api/trades/route.ts` | `POST` | session cookie | `{ symbol, side, quantity }` | `201` `{ trade, holding, cashBalance }` or `422` with a specific reason (`insufficient_cash`, `insufficient_shares`, `symbol_halted`, `invalid_quantity`, `market_data_unavailable`) |
| `app/api/holdings/route.ts` | `GET` | session cookie | — | `Holding[]` |
| `app/api/symbols/route.ts` | `GET` | none | — | curated symbol universe (static list, not from DB) |
| `app/api/seed-history/[symbol]/route.ts` | `GET` | none | — | `SeedPriceHistory[]` for the chart's initial load (candlesticks before live ticks arrive) |

**Trading-halt and price/order-book data are not Route Handlers** — those
come from the WS relay's live stream per SPEC §4/§5, not REST.

`proxy.ts` (project root) does the optimistic-auth pass from the vendored
guide: redirect unauthenticated `/dashboard` access, but only ever reads the
cookie — no DB hit, per the docs' explicit warning that proxy runs on every
request including prefetches.

---

## 4. WS relay contract (`relay/` — separate Node process, not part of Next.js)

Not a Route Handler; a standalone `ws` server. Documented here because it's
the other half of "API contracts."

- **Handshake**: client connects with `?token=<jwt>` (or first-message
  token per SPEC §5); relay verifies via `jose` against `WS_JWT_SECRET`
  (shared env var, no DB round-trip).
- **Client → server messages**: `{ type: 'subscribe', symbols: string[] }`,
  `{ type: 'unsubscribe', symbols: string[] }`.
- **Server → client messages**: `{ type: 'snapshot', symbol, price, book,
  isHalted }` (on subscribe/reconnect), `{ type: 'tick', symbol, price,
  book, ts }`, `{ type: 'halt', symbol }`, `{ type: 'resume', symbol, price }`.
  `snapshot` carries `isHalted` (not just `price`/`book`) because `halt`/
  `resume` only fire on the transition — a client that subscribes or
  reconnects *while a symbol is already halted* would otherwise have no
  way to learn that from the stream at all.

---

## 5. Files to create / modify

```
prisma/
  schema.prisma                        [new]
  migrations/                          [new, generated]
  migrations/.../migration.sql         [new, hand-edited] — its own dedicated empty migration (`prisma migrate dev --create-only`), not appended to whichever migration happens to be latest, adding `CREATE EXTENSION IF NOT EXISTS pg_cron;` + `cron.schedule(...)` for guest cleanup (§6.2); Prisma's schema DSL can't express this

scripts/
  seed-price-history.ts                [new] — Alpha Vantage fetch, one-time

relay/
  index.ts                             [new] — ws server bootstrap
  jwt.ts                               [new] — verify WS_JWT_SECRET tokens
  market-engine.ts                     [new] — GBM tick generator + halts
  order-book.ts                        [new] — derives book from price+spread
  connection-manager.ts                [new] — subscribe/fan-out/cleanup

app/
  layout.tsx                           [modify] — wrap providers (TanStack Query, MUI theme)
  page.tsx                             [modify] — replace scaffold with dashboard shell/redirect
  dashboard/
    page.tsx                           [new] — fixed 4-widget layout (§8)
    layout.tsx                         [new] — guest auto-provision + getUser() per vendored DAL pattern
  api/
    session/route.ts                   [new]
    auth/signup/route.ts               [new]
    auth/login/route.ts                [new]
    auth/logout/route.ts               [new]
    ws-token/route.ts                  [new]
    watchlist/route.ts                 [new]
    watchlist/[symbol]/route.ts        [new]
    trades/route.ts                    [new]
    holdings/route.ts                  [new]
    symbols/route.ts                   [new]
    seed-history/[symbol]/route.ts     [new]
  lib/
    dal.ts                             [new] — verifySession() (also touches User.lastActiveAt, throttled), getUser()
    session.ts                         [new] — encrypt/decrypt/createSession/deleteSession (jose)
    db.ts                              [new] — Prisma client singleton
    decimal.ts                         [new] — decimal.js helpers shared client/server
    symbols.ts                         [new] — curated 15–25 symbol universe constant + a DEFAULT_WATCHLIST subset
  store/
    dashboard-store.ts                 [new] — Zustand: selectedSymbol, selectedTimeframe, connectionStatus
  components/
    watchlist/Watchlist.tsx            [new]
    chart/PriceChart.tsx               [new] — lightweight-charts wrapper
    orderbook/OrderBook.tsx            [new] — virtualized, rAF-batched
    holdings/HoldingsPanel.tsx         [new]
    holdings/TradeForm.tsx             [new]
  hooks/
    useWebSocket.ts                    [new] — connection lifecycle, backoff/reconnect, resnapshot
    useMarketData.ts                   [new] — subscribes selectedSymbol from store, feeds widgets

proxy.ts                               [new, project root] — optimistic auth redirect (NOT middleware.ts)
next.config.ts                         [modify] — no cacheComponents flag (see §0.2); may still need other config (image domains, etc. — none identified yet)
.env / .env.example                    [new] — DATABASE_URL, WS_JWT_SECRET, SESSION_SECRET, ALPHA_VANTAGE_API_KEY
package.json                           [modify] — add deps from §1, add `db:seed`, `relay:dev` scripts
```

---

## 6. Open decisions before implementation starts

1. ~~Stateless vs. database sessions~~ — **resolved: pure stateless JWT**,
   exactly as SPEC §6 originally specified. A JWT + Redis revocation-cache
   hybrid (instant kill-switch, checked by both Route Handlers and the WS
   relay via pub/sub) was considered — see discussion below — and
   explicitly set aside: every trade is already re-validated server-side
   per request regardless of session model, and nothing in SPEC needs a
   revocation kill-switch (no admin/ban flow, no "log out other devices").
   Without a concrete feature driving it, a third stateful service cuts
   against SPEC §11's deliberately simple single-host/two-process
   deployment story. No `Session`/`Redis` table or service — sessions stay
   exactly as modeled in §2/§3.
2. ~~Guest cleanup mechanism~~ — **resolved: `pg_cron`**. `User.lastActiveAt`
   is the expiry clock; `WatchlistItem`/`Holding`/`Trade` already
   cascade-delete off `User` (§2), so the scheduled job is one statement:
   `DELETE FROM "User" WHERE "isGuest" = true AND "lastActiveAt" < now() - interval '30 days'`,
   registered via `cron.schedule(...)` after `CREATE EXTENSION IF NOT EXISTS pg_cron;`
   (added as a raw-SQL Prisma migration, since Prisma's schema DSL has no
   extension/cron primitive). Note this **constrains decision #4**: the
   Postgres instance must support `pg_cron` — confirmed available on
   self-managed Postgres (e.g. a Fly.io Postgres Machine you administer),
   not guaranteed on managed offerings (Render's managed Postgres does not
   whitelist it as of writing) — so verify `pg_cron` support for whichever
   Postgres is paired with the chosen host before Milestone 8, not after.
   Also needs `lastActiveAt` actually touched on guest activity during
   session validation (throttled, not a write on every request — see §7
   step 6, `app/lib/dal.ts`'s `verifySession()`), since `@updatedAt` alone
   only bumps on a write to that row.
3. ~~bcrypt vs bcryptjs~~ — **resolved: `bcryptjs`**. Pure JS, no native
   bindings to compile/ship across whatever host and container base image
   end up in play — removes one more variable from the still-open
   deployment-host decision (#4) rather than adding to it. Hashing latency
   is higher than native `bcrypt`, immaterial at this app's signup/login
   volume.
4. ~~Deployment host~~ — **resolved: Fly.io**. Chosen over Render (free, but
   its managed Postgres doesn't support `pg_cron`, conflicting with item 2;
   free web services also sleep after 15 min idle, at odds with SPEC's
   "reviewer opens the link and is immediately trading" goal) and Railway
   (no standing free tier anymore, just a one-time trial credit — no
   meaningfully better than Fly at that point). Not literally free — a card
   is required, and Fly bills by usage — but a demo at this scale
   (two small Machines: Next.js app + relay, plus a Postgres Machine)
   should run a few $/month, not a meaningful cost. In exchange: Postgres
   runs as a Machine you administer, so `pg_cron` (item 2) just works with
   no extension-whitelist risk; the two-process architecture maps directly
   onto Fly's process groups (`fly.toml` `[processes]` — one for the
   Next.js app, one for the WS relay) exactly as SPEC §11 describes; no
   cold-start sleep, no free-tier database expiry timer to manage.

All four items in this section are now resolved. Milestone 8 (deploy) can
proceed against: Fly.io, two process groups, a self-managed Postgres
Machine with `pg_cron` enabled, `bcryptjs` for password hashing, and
stateless JWT sessions.

---

## 7. Sequential Implementation & Verification Plan

Every step lists **Depends on** (step numbers that must be built *and
verified* first) and **Verify** (the concrete check that has to pass before
moving on — not "looks right," an actual command or observable behavior).
Steps with no dependency on each other within the same phase can be done in
either order or in parallel; the numbering is a safe default sequence, not
a claim that everything is strictly linear.

One new component surfaces in Phase D that isn't in §2/§3 as originally
written — flagged inline where it's introduced (step 21) rather than
silently added, since it changes the data model.

### Phase A — Environment & tooling

**1. Install new dependencies.**
Add the §1 package list to `package.json`, `npm install`.
Depends on: nothing.
Verify: `npm install` exits 0; lockfile updates; no peer-dependency errors.

**2. Local dev Postgres + env files.**
Run a local Postgres (e.g. `docker run postgres:16`), write `.env` /
`.env.example` with `DATABASE_URL`, `WS_JWT_SECRET`, `SESSION_SECRET`,
`ALPHA_VANTAGE_API_KEY` (dev values).
Depends on: nothing (can precede or follow step 1).
Verify: `psql "$DATABASE_URL" -c '\dt'` connects and returns an empty table
list.

**3. `prisma/schema.prisma` + initial migration.**
Write the schema from §2 (without `SymbolState` — that's added in step 21),
run `npx prisma migrate dev --name init`.
Depends on: 2.
Verify: migration succeeds; `psql` or `prisma studio` shows `User`,
`WatchlistItem`, `Holding`, `Trade`, `SeedPriceHistory`.

**4. `app/lib/db.ts` — Prisma client singleton.**
Depends on: 3.
Verify: `npx tsx -e "import {db} from './app/lib/db'; db.user.count().then(console.log)"` runs without error.

**4a. `app/lib/symbols.ts` — curated 15–25 symbol universe + a named
`DEFAULT_WATCHLIST` subset.**
Relocated here from its original Phase D slot (step 14) — that placement
caused a forward-reference bug (step 13 depended on step 14, which came
*after* it), and separately, guest auto-provisioning (step 7) turns out to
need the default-watchlist subset earlier than Phase D anyway. Pure
constant, no dependencies, so moving it earlier costs nothing.
Depends on: nothing.
Verify: both exports have the expected shape; imported cleanly by step 7
(default watchlist), step 13 (seed script), and step 27 (watchlist
validation) later on.

### Phase B — Auth & session foundation

**5. `app/lib/session.ts` — encrypt/decrypt/createSession/deleteSession (jose).**
Depends on: 1 (jose), 2 (`SESSION_SECRET`).
Verify: unit test — encrypt→decrypt round-trips a payload exactly; a
tampered token fails to decrypt.

**6. `app/lib/dal.ts` — `verifySession()`, `getUser()`.**
`verifySession()` is also where `User.lastActiveAt` gets touched on guest
activity, satisfying §6.2's guest-cleanup clock — throttled (e.g. only
write if the existing value is more than an hour stale), not on every
single call, since `@updatedAt` alone only bumps on an actual write.
Depends on: 5, 4.
Verify: unit/integration test with a mocked cookie store — valid session
resolves a user; missing/invalid session redirects (or returns null, per
whichever contract gets implemented — pin down and test the one chosen);
a session past the throttle window updates `lastActiveAt` on the next
call, a fresh one doesn't trigger a redundant write.

**7. `app/api/session/route.ts` — guest auto-provision.**
Per SPEC §6, a new guest also gets a **default watchlist**, not an empty
one — this was missing from the original step list. Creates the
`DEFAULT_WATCHLIST` symbols (step 4a) as `WatchlistItem` rows alongside
the new `User` row.
Depends on: 6, 4, 4a.
Verify: integration test — `POST` with no cookie returns `Set-Cookie`,
creates an `isGuest: true` `User` row, **and** that user already has the
default watchlist's `WatchlistItem` rows present.

**8. `proxy.ts` — optimistic auth redirect.**
Cookie-only check per §0's Proxy guidance — no DB/Redis read here.
Depends on: 5.
Verify: request `/dashboard` with no cookie → redirected; with a valid
session cookie → passes through.

**9. `app/api/auth/signup/route.ts`, `app/api/auth/login/route.ts`.**
bcryptjs hash/compare; signup upgrades the current guest row in place
(SPEC §6) rather than creating a new user.
Depends on: 6, 1 (bcryptjs), 4.
Verify: integration tests — signup from an existing guest session keeps the
same `User.id`, sets `email`/`passwordHash`, flips `isGuest` to `false`;
duplicate email → `409`; login with wrong password → `401`.

**10. `app/api/auth/logout/route.ts`.**
Depends on: 5.
Verify: integration test — cookie cleared; a subsequent `verifySession()`
call fails.

### Phase C — WS handshake contract

**11. `app/api/ws-token/route.ts` — mints the short-lived WS JWT.**
Depends on: 6, 2 (`WS_JWT_SECRET`).
Verify: integration test — authenticated request returns a token; decoding
it with `jose`/`WS_JWT_SECRET` shows the expected `userId` claim and an
expiry ~60s out.

**12. `relay/jwt.ts` — verifies tokens minted by step 11.**
Depends on: 11 (must share the exact secret + claim shape).
Verify: unit test — a token signed by step 11's logic verifies here;
expired or tampered tokens are rejected.

### Phase D — Market data engine

**13. `scripts/seed-price-history.ts` — Alpha Vantage → `SeedPriceHistory`.**
Depends on: 3, 2 (`ALPHA_VANTAGE_API_KEY`), 4a (needs the symbol list to
fetch).
Verify: run against 1–2 symbols; rows land with plausible OHLC values;
re-running is a no-op / upsert (`@@unique([symbol, date])` holds).

**14.** *(relocated — see step 4a, `app/lib/symbols.ts`. Left as a marker
rather than renumbering steps 15–44.)*

**15. `app/lib/decimal.ts` — decimal.js helpers, shared client/server.**
Depends on: 1 (decimal.js).
Verify: unit test — known float-unsafe cases (e.g. `0.1 + 0.2`) produce
exact decimal results.

**16. `relay/market-engine.ts` — GBM tick generator.**
Seeded from `SeedPriceHistory`-derived drift/volatility.
Depends on: 13, 15.
Verify: unit test — identical seed produces an identical tick sequence
(SPEC §10's determinism requirement); mean/variance over N ticks roughly
matches the derived parameters.

**17. `relay/order-book.ts` — bid/ask ladder derived from price.**
Depends on: 16.
Verify: unit test — for a fixed input price, bids < price < asks, depth
curve is monotonic.

**18. Trading-halt logic in `relay/market-engine.ts`.**
Depends on: 16.
Verify: unit test — forcing the anomaly trigger (via an injectable/mocked
RNG) halts the symbol, ticking stops, resumes after the configured pause
at a new price.

**19. `relay/connection-manager.ts` — subscribe/unsubscribe/fan-out.**
Depends on: 16, 17, 18.
Verify: unit/integration test with mocked sockets — first subscribe starts
a symbol's simulation, last unsubscribe stops it, ticks reach only
subscribed sockets.

**20. `relay/index.ts` — ws server bootstrap.**
Wires handshake (12) + connection manager (19), sends snapshot before
resuming the tick stream on (re)connect (SPEC §5).
Depends on: 12, 19.
Verify: run the relay standalone; a raw `ws` test client with a valid token
(from 11) receives a snapshot then ticks; an invalid/missing token gets the
connection closed.

**21. `SymbolState` table (schema addition) — flagged, not in original §2.**
```prisma
model SymbolState {
  symbol    String   @id
  lastPrice Decimal  @db.Decimal(14, 4)
  isHalted  Boolean  @default(false)
  updatedAt DateTime @updatedAt
}
```
`@updatedAt` (same as `User.lastActiveAt` in §2) lets Prisma stamp the
timestamp automatically on every write, rather than the relay having to
remember to set it by hand on each throttled/halt-transition write.
**Why this exists:** trade execution runs in the Next.js process (step 32)
and needs the *authoritative* current price/halt status to validate and
price a trade, but that state lives only in the relay process's memory —
the two processes don't share memory, only Postgres (SPEC §3). This table
is the simplest bridge, reusing the one thing both processes already share
rather than adding an inter-process HTTP call. Flagging it here since it's
a real (small) addition to §2's schema — say so if a different bridge
(e.g. relay exposing an internal HTTP endpoint) is preferred instead.
Depends on: 3.
Verify: migration applies; table is queryable from both a Next.js-side and
a relay-side Prisma/pg client.

**22. Relay reads/writes `SymbolState` — writes throttled, startup reads for continuity, non-blocking, single-writer.**
Four behaviors, all belonging together since they're all "how the relay
talks to this table" — split across two of §5's existing `relay/` files
rather than a new one: the continuity read belongs in
`connection-manager.ts` (it fires at the same "first subscriber" moment
that module already owns, per step 19), while the throttled/halt writes
belong in `market-engine.ts` (it fires from the same per-symbol tick loop
that module already owns, per steps 16/18):
- **Throttled writes**: at most once/second per symbol while it's actively
  simulating — a 250ms tick cadence would otherwise hammer Postgres from a
  long-running process. Halt/resume transitions always write through
  immediately (unthrottled), since trade validation (step 32) depends on
  seeing a halt without a ~1s delay.
- **Startup continuity read**: when a symbol starts simulating (first
  subscriber, per step 19), check `SymbolState` for an existing row first.
  If present, resume from its `lastPrice` instead of the original
  `SeedPriceHistory`-derived starting price — this is what makes a relay
  restart look like resumed continuity rather than a price jump. Drift/
  volatility parameters still come from `SeedPriceHistory` either way; only
  the starting price differs.
- **Non-blocking writes**: the `SymbolState` write must be fire-and-forget
  relative to the tick-broadcast loop — never `await`ed inline before a
  tick is sent to subscribed clients. A slow or temporarily-failing DB
  write must log and continue, not stall or crash live tick delivery.
- **Single writer**: only relay code ever writes `SymbolState`; the
  Next.js side (step 32) only reads. Prisma doesn't enforce this at the
  schema level, so state it as a convention in the module itself, not just
  here.

Depends on: 21, 16, 18, 19, 20 (continuity read happens during
bootstrap/first subscribe, per step 19). Relay needs its own DB client —
reuse the Prisma client
generated in step 3/4, imported into `relay/`.
Verify: running ticks update `SymbolState.lastPrice` at roughly the
throttled rate; a halt/resume event updates `isHalted` immediately,
without waiting for the next throttle window; killing and restarting the
relay process mid-simulation resumes each symbol from its last persisted
price (no jump back to the seed); temporarily pointing the relay at an
unreachable DB does not stall or crash tick delivery to a connected test
client.

*(Local-dev note: `pg_cron` itself is not installed on a plain local
Postgres container, so it can't be exercised locally. The guest-cleanup
**statement** — the `DELETE FROM "User" WHERE "isGuest" = true AND
"lastActiveAt" < now() - interval '30 days'` from §6.2 — has no dedicated
build step of its own since it lives directly in the migration SQL (§5);
it can still be validated locally by hand (insert a stale guest row, run
the statement, confirm the row and its cascaded children are gone). Actual
`pg_cron` *scheduling* only happens against the Fly Postgres Machine, in
step 42.)*

### Phase E — Frontend shell & state

**23. `app/store/dashboard-store.ts` — Zustand store.**
`selectedSymbol`, `selectedTimeframe`, `connectionStatus`.
Depends on: 1 (zustand).
Verify: unit test — actions update state as expected; store resets between
tests (no cross-test leakage).

**24. `app/layout.tsx` — TanStack Query + MUI providers.**
Depends on: 1.
Verify: `npm run dev`, load `/`, no console errors about missing query/theme
context.

**25. `app/dashboard/layout.tsx` — guest auto-provision + `getUser()`.**
Depends on: 7 (or a direct DAL call doing the same thing), 6.
Verify: visiting `/dashboard` with no prior cookie creates a guest session
(DB row + `Set-Cookie`) and renders without a redirect loop.

**25a. `app/page.tsx` — root redirect to `/dashboard`.**
Declared in §5's file list but originally missing its own step. SPEC §1's
"reviewer opens the link and is immediately trading" goal means `/` itself
has to lead somewhere live, not stay the default scaffold page.
Depends on: 25 (the target route must exist and handle guest provisioning
before it's worth redirecting to).
Verify: visiting `/` redirects to `/dashboard`; a fresh guest still gets
auto-provisioned via (25)'s logic after the redirect.

**26. `app/hooks/useWebSocket.ts` — connection lifecycle.**
Fetches a token (11), connects to the relay (20), exponential-backoff
reconnect, resnapshot handling, updates `connectionStatus` in the store (23).
Depends on: 11, 20, 23.
Verify: manual — with the relay running, the dashboard shows ticks flowing;
killing the relay process shows a "Reconnecting…" state with backoff;
restarting it shows automatic resnapshot with no duplicate/missing data.

**26a. `app/hooks/useMarketData.ts` — derives per-symbol live data for the
currently selected symbol.**
Also declared in §5 but originally missing its own step. Thin layer over
(26)'s raw multiplexed tick/snapshot/halt stream, filtered to
`store.selectedSymbol` (23) — and the one place that exposes per-symbol
`isHalted` state to components. That state isn't tracked in the global
Zustand store, since SPEC §8 only specifies `selectedSymbol`/
`selectedTimeframe`/connection status there, and halt status is only ever
needed for whichever symbol is currently selected — adding it to (23)
would be scope creep on a store SPEC deliberately kept small.
Depends on: 26, 23.
Verify: unit test with a mocked tick/halt stream — changing
`selectedSymbol` drops stale data from the previously selected symbol; a
`halt`/`resume` message for the selected symbol flips the hook's
`isHalted` output; a `snapshot` with `isHalted: true` (per §4's contract)
seeds `isHalted` correctly on first subscribe, without needing a `halt`
message to have been observed first.

### Phase F — Watchlist & chart

**27. `app/api/watchlist/route.ts` (GET/POST), `app/api/watchlist/[symbol]/route.ts` (DELETE).**
Depends on: 6, 4a, 4.
Verify: integration tests — new user's `GET` is `[]`; `POST` of a curated
symbol → `201`; `POST` of a non-curated symbol → `422`; duplicate `POST` →
`409`; `DELETE` removes the row.

**28. `app/components/watchlist/Watchlist.tsx`.**
Depends on: 27, 23, 24.
Verify: manual — add a symbol, reload, confirm it persisted; click a row,
confirm `selectedSymbol` updates in the store.

**29. `app/api/seed-history/[symbol]/route.ts`.**
Depends on: 13, 4.
Verify: integration test — a seeded symbol returns ascending-date OHLC
rows; an unseeded symbol returns an empty result (pin down and test which
of `[]` vs `404` is the contract).

**30. `app/components/chart/PriceChart.tsx`.**
Historical load via (29), live ticks via (26a) (already filtered to
`selectedSymbol`).
Depends on: 29, 26a, 23.
Verify: manual — selecting a symbol loads its history then live ticks
append; switching symbols fully replaces the chart data, no stale bleed.

### Phase G — Order book

**31. `app/components/orderbook/OrderBook.tsx`.**
Virtualized, rAF-batched updates from (26a), already keyed off
`selectedSymbol`.
Depends on: 26a, 23, 17 (book shape contract).
Verify: manual — rapid ticks stay smooth (no visible per-message
re-render); switching symbols swaps the book contents.

### Phase H — Trading loop

**32. `app/api/trades/route.ts` (GET/POST).**
Server-side validation: sufficient cash (BUY), sufficient shares (SELL),
symbol not halted, decimal-safe math throughout. Two additional rules from
the `SymbolState`-staleness review:
- **Staleness guard**: reject with `market_data_unavailable` if
  `SymbolState.updatedAt` is older than a fixed threshold (e.g. 10s —
  generous relative to the ~1s write throttle, tight enough to catch a
  relay that's actually down) rather than silently trading against an
  arbitrarily old frozen price.
- **Missing-row handling**: treat "no `SymbolState` row for this symbol"
  identically to "stale" (same rejection), covering the narrow race where
  a symbol was just subscribed to and its first write hasn't landed yet.

Execution price itself is whatever `SymbolState.lastPrice` holds — up to
~1s behind the live tick a user last saw on screen (accepted/documented
simplification, not a bug: see §7 Phase D discussion for why this wasn't
tightened further).

Depends on: 6, 4, 15, 22 (reads `SymbolState` for authoritative
price/halt status).
Verify: integration tests covering each rejection path
(`insufficient_cash`, `insufficient_shares`, `symbol_halted`,
`invalid_quantity`, `market_data_unavailable` for both stale and missing
`SymbolState` rows) plus a successful trade updating `Holding` (quantity,
avg cost basis) and `User.cashBalance` with known, hand-checked numbers.

**33. `app/api/holdings/route.ts`, `app/api/symbols/route.ts`.**
Depends on: 4, 4a.
Verify: integration test — holdings reflect trades from (32); symbols
returns the curated universe from (4a).

**34. `app/components/holdings/HoldingsPanel.tsx`, `TradeForm.tsx`.**
Unrealized P&L recalculated live from (26a)'s price stream; buy/sell form
posts to (32); `TradeForm` disables when (26a) reports the selected
symbol as halted.
Depends on: 33, 26a, 23, 15.
Verify: manual — place a trade, see holdings update immediately and
unrealized P&L move with live ticks; attempt an oversell/overspend and
confirm the *server* rejects it, surfaced in the UI (not just a disabled
button); halting the selected symbol disables the form.

**35. `app/dashboard/page.tsx` — assemble the fixed 4-widget layout.**
Depends on: 28, 30, 31, 34.
Verify: manual full walkthrough — fresh guest session, select a symbol in
the watchlist, confirm chart + order book + holdings context all update
together (SPEC §8's core interactivity story).

### Phase I — Resilience, empty & loading states

**36. Empty states (no watchlist yet) + distinct loading states (history
fetch vs. WS connect) across widgets.**
Depends on: 35.
Verify: manual — a brand-new guest sees an "add your first symbol" prompt,
not a blank widget; artificially delaying the relay vs. the history fetch
shows two visibly different loading indicators, never conflated.

**37. Reconnect/resync + halt polish (SPEC §9).**
`TradeForm` disables for a halted symbol (via 26a, now that step 34 wires
it up); "Reconnecting…" banner; resnapshot on reconnect leaves no
stale/duplicate data.
Depends on: 26a, 34, 20, 22.
Verify: manual chaos test — repeatedly kill/restart the relay mid-session;
confirm no stale price is ever shown as live, and the trade form disables
during a halt and re-enables on resume; additionally, force a halt, then
reconnect (or have a second client subscribe) *while still halted* —
confirm the trade form disables immediately from the snapshot alone,
without needing to observe the original `halt` transition.

### Phase J — Testing pass (SPEC §10)

**38. Unit tests.**
P&L/cost-basis math (32), order-book diff/merge (17), GBM determinism (16),
reconnect backoff timing (26). Can be written alongside the steps they
cover rather than strictly after — listed here as the pass that closes any
remaining coverage gaps.
Depends on: 16, 17, 26, 32.
Verify: `npx vitest run` — all green.

**39. Integration tests.**
API routes (auth flows from 9/10, trade execution + rejection paths from
32) against a real test Postgres; relay message handling (subscribe/
unsubscribe/snapshot-on-reconnect, 19/20) against a mock client.
Depends on: 7, 9, 10, 27, 32, 19, 20; a disposable test database separate
from the local dev DB.
Verify: integration test command (e.g. `npx vitest run --config
vitest.integration.config.ts`) — all green against the test DB.

**40. E2E (Playwright).**
Guest auto-provision → select symbol → trade → see holdings/P&L update
live; dropped-WS-connection reconnect/resync scenario.
Depends on: 35, 37.
Verify: `npx playwright test` — all green against the full local stack
(Next.js dev server + relay + local Postgres running together).

### Phase K — Deployment (SPEC §11)

**41. `fly.toml` — two process groups (app, relay) + Postgres Machine.**
Depends on: functionally complete enough to be worth deploying — practically
after Phase J, though an earlier throwaway deploy as a smoke test is fine.
Verify: `fly deploy` succeeds; `fly status` shows both processes running.

**42. Apply the `pg_cron` migration (§5's hand-edited `migration.sql`) against the Fly Postgres Machine.**
Depends on: 41, 3.
Verify: `SELECT * FROM cron.job;` shows the guest-cleanup job registered;
manually insert a stale guest row with an old `lastActiveAt`, trigger/await
the job, confirm it (and its cascaded rows) are gone.

**43. Run `scripts/seed-price-history.ts` once against the production DB.**
Depends on: 41, 13.
Verify: `SeedPriceHistory` populated for all curated symbols in prod.

**44. Production smoke test.**
Open the public Fly URL in a fresh/incognito session; confirm guest
auto-provision, live ticks, a full trade round-trip, and a forced
relay-restart reconnect — SPEC §1's "zero-friction demo" promise end to
end, on real infrastructure.
Depends on: 41, 42, 43 (and transitively everything before them).
Verify: manual pass/fail against SPEC §1's goals and §9's edge cases,
executed against the live URL.
