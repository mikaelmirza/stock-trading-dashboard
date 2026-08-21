import { NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { verifySession } from "@/app/lib/dal";

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const holdings = await db.holding.findMany({ where: { userId: session.userId } });
  return NextResponse.json(holdings);
}
