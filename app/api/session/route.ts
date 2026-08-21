import { NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { createSession } from "@/app/lib/session";
import { DEFAULT_WATCHLIST } from "@/app/lib/symbols";

// Zero-friction guest bootstrap (SPEC §6): no auth required, always
// provisions a fresh guest — the caller (GuestProvision, PLAN step 25a) only
// ever reaches this after page.tsx's server-side verifySession() check has
// already confirmed there's no valid session.
export async function POST() {
  const user = await db.user.create({
    data: {
      isGuest: true,
      lastActiveAt: new Date(),
      watchlist: {
        create: DEFAULT_WATCHLIST.map((symbol) => ({ symbol })),
      },
    },
  });

  await createSession(user.id);

  return NextResponse.json({ userId: user.id, isGuest: user.isGuest });
}
