import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/app/lib/db";
import { verifySession } from "@/app/lib/dal";
import { isCuratedSymbol } from "@/app/lib/symbols";

const bodySchema = z.object({ symbol: z.string() });

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const items = await db.watchlistItem.findMany({
    where: { userId: session.userId },
    orderBy: { addedAt: "asc" },
  });
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { symbol } = parsed.data;

  if (!isCuratedSymbol(symbol)) {
    return NextResponse.json({ error: "symbol_not_curated" }, { status: 422 });
  }

  const existing = await db.watchlistItem.findUnique({
    where: { userId_symbol: { userId: session.userId, symbol } },
  });
  if (existing) {
    return NextResponse.json({ error: "already_in_watchlist" }, { status: 409 });
  }

  const item = await db.watchlistItem.create({
    data: { userId: session.userId, symbol },
  });
  return NextResponse.json(item, { status: 201 });
}
