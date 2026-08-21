import { NextResponse } from "next/server";
import { db } from "@/app/lib/db";

// No auth required — historical OHLC bars aren't user-specific. An unseeded
// symbol returns an empty array rather than 404, matching how the rest of
// this API treats "nothing here yet" (PLAN step 29).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;

  const rows = await db.seedPriceHistory.findMany({
    where: { symbol },
    orderBy: { date: "asc" },
  });

  // BigInt (volume) has no native JSON representation — serialize it
  // explicitly rather than letting JSON.stringify throw.
  const serialized = rows.map((row) => ({ ...row, volume: row.volume.toString() }));

  return NextResponse.json(serialized);
}
