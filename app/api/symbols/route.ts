import { NextResponse } from "next/server";
import { SYMBOLS } from "@/app/lib/symbols";

// No auth required — the curated universe is a static constant, not
// user-specific (PLAN §3).
export async function GET() {
  return NextResponse.json(SYMBOLS);
}
