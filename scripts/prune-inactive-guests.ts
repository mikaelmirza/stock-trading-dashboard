import { db } from "@/app/lib/db";

// Render deploy: replaces the pg_cron-based approach in PLAN.md §6.2 (see
// prisma/migrations/20260821022623_guest_cleanup_cron — left as a no-op
// migration) since pg_cron isn't available on Render's managed Postgres.
// Run on a schedule by a Render Cron Job service instead of inside
// Postgres itself; same rule, same cascade-delete behavior off User
// (schema.prisma's onDelete: Cascade already covers WatchlistItem/
// Holding/Trade).
async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const { count } = await db.user.deleteMany({
    where: { isGuest: true, lastActiveAt: { lt: cutoff } },
  });
  console.log(`pruned ${count} inactive guest account(s) older than ${cutoff.toISOString()}`);
}

main()
  .catch((error: unknown) => {
    console.error("prune-inactive-guests failed:", error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
