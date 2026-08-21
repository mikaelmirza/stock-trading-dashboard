import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { verifySession } from "@/app/lib/dal";

const WS_JWT_SECRET = process.env["WS_JWT_SECRET"];
if (!WS_JWT_SECRET) {
  throw new Error("WS_JWT_SECRET env var is required");
}
const key = new TextEncoder().encode(WS_JWT_SECRET);

// Short-lived (~60s) token scoped to the current session, handed to the
// browser to authenticate its WS handshake with the relay process (SPEC
// §5/§6) — the relay verifies it against the same shared secret with no DB
// round-trip, since it's a completely separate process from Next.js.
export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const token = await new SignJWT({ userId: session.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(key);

  return NextResponse.json({ token });
}
