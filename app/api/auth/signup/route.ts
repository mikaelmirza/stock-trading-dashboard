import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/app/lib/db";
import { verifySession } from "@/app/lib/dal";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Upgrades the current guest session's User row in place (SPEC §6) — same
// User.id, so existing watchlist/holdings/trades carry over untouched,
// rather than creating a second row and losing the guest's paper portfolio.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.update({
    where: { id: session.userId },
    data: { email, passwordHash, isGuest: false },
  });

  return NextResponse.json({ userId: user.id });
}
