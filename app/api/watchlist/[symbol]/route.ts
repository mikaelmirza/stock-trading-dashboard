import { NextResponse } from "next/server";
import { db } from "@/app/lib/db";
import { verifySession } from "@/app/lib/dal";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const { symbol } = await params;
  await db.watchlistItem.deleteMany({
    where: { userId: session.userId, symbol },
  });

  return new Response(null, { status: 204 });
}
