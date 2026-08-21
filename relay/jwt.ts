import "dotenv/config";
import { jwtVerify } from "jose";

const WS_JWT_SECRET = process.env["WS_JWT_SECRET"];
if (!WS_JWT_SECRET) {
  throw new Error("WS_JWT_SECRET env var is required");
}
const key = new TextEncoder().encode(WS_JWT_SECRET);

// Verifies tokens minted by app/api/ws-token/route.ts — shares the same
// secret + claim shape, no DB round-trip (SPEC §5). Never throws: an
// invalid/expired/missing token is just "not authenticated" to the relay,
// which closes the connection rather than crashing.
export async function verifyWsToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload["userId"] !== "string") return null;
    return { userId: payload["userId"] };
  } catch {
    return null;
  }
}
