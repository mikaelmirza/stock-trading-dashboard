import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;
const deleteCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
    set: vi.fn(),
    delete: deleteCookie,
  }),
}));

describe("POST /api/auth/logout", () => {
  let userId: string;

  afterEach(async () => {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    cookieValue = undefined;
    deleteCookie.mockClear();
  });

  it("returns 401 with no session", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("clears the session cookie and returns 204", async () => {
    const user = await db.user.create({ data: { isGuest: true, lastActiveAt: new Date() } });
    userId = user.id;
    cookieValue = await encrypt({ userId });

    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(204);
    expect(deleteCookie).toHaveBeenCalledWith("session");
  });
});
