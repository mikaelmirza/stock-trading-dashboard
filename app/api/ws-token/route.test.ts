import { afterEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

const key = new TextEncoder().encode(process.env["WS_JWT_SECRET"]);

describe("GET /api/ws-token", () => {
  let userId: string;

  afterEach(async () => {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    cookieValue = undefined;
  });

  it("returns 401 with no session", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("mints a short-lived token carrying the session's userId", async () => {
    const user = await db.user.create({ data: { isGuest: true, lastActiveAt: new Date() } });
    userId = user.id;
    cookieValue = await encrypt({ userId });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const { token } = await res.json();

    const { payload } = await jwtVerify(token, key);
    expect(payload["userId"]).toBe(userId);
    const expiresInSeconds = (payload.exp as number) - (payload.iat as number);
    expect(expiresInSeconds).toBeLessThanOrEqual(60);
    expect(expiresInSeconds).toBeGreaterThan(0);
  });
});
