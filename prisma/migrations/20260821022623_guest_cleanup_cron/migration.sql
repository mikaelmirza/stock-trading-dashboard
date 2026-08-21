-- PLAN.md §6.2 / Phase K step 42: scheduled guest-account cleanup.
--
-- Requires pg_cron, which is only available on a self-managed Postgres
-- instance (e.g. a Fly Postgres Machine you administer) — NOT available on
-- most managed Postgres offerings, and not installed on local dev Postgres
-- either. This migration is intentionally NOT applied to the local dev
-- database (see the accompanying `prisma migrate resolve --applied` note
-- in the repo's deploy notes) — it only runs for real via
-- `prisma migrate deploy` against the production database, where pg_cron
-- is actually available.
--
-- WatchlistItem/Holding/Trade rows already cascade-delete off User (see
-- schema.prisma's onDelete: Cascade), so pruning stale guests is one
-- statement plus the cron registration.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'prune-inactive-guests',
  '0 3 * * *', -- daily at 03:00 UTC
  $$DELETE FROM "User" WHERE "isGuest" = true AND "lastActiveAt" < now() - interval '30 days'$$
);
