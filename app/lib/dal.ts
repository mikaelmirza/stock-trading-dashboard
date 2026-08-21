import { cache } from "react";
import { decrypt, getSessionCookie } from "@/app/lib/session";
import { db } from "@/app/lib/db";
import type { User } from "@/app/generated/prisma/client";

// Only bump lastActiveAt if it's more than an hour stale — @updatedAt only
// fires on an actual write, so without this throttle every single request
// from an active user would write the User row (PLAN §6/step 6).
const ACTIVITY_THROTTLE_MS = 60 * 60 * 1000;

// cache() dedupes within a single request/render pass (the vendored DAL
// guide's pattern) — multiple components calling verifySession() during the
// same request share one cookie read/JWT verify, not one each.
export const verifySession = cache(async (): Promise<{ userId: string } | null> => {
  const cookie = await getSessionCookie();
  const session = await decrypt(cookie);
  if (!session?.userId) return null;

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { lastActiveAt: true },
  });
  // Session cookie decrypts fine but references a user row that's gone
  // (e.g. a pruned guest) — not a valid session.
  if (!user) return null;

  const isStale = Date.now() - user.lastActiveAt.getTime() > ACTIVITY_THROTTLE_MS;
  if (isStale) {
    await db.user.update({
      where: { id: session.userId },
      data: { lastActiveAt: new Date() },
    });
  }

  return { userId: session.userId };
});

export const getUser = cache(async (): Promise<User | null> => {
  const session = await verifySession();
  if (!session) return null;
  return db.user.findUnique({ where: { id: session.userId } });
});
