import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/app/lib/db";

const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: setCookie, delete: vi.fn() }),
}));

function req(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    if (createdUserIds.length) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
    setCookie.mockClear();
  });

  it("returns 401 for an unknown email", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ email: "nobody@example.com", password: "whatever1" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a wrong password", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 10);
    const user = await db.user.create({
      data: { isGuest: false, email: "login-test@example.com", passwordHash, lastActiveAt: new Date() },
    });
    createdUserIds.push(user.id);

    const { POST } = await import("./route");
    const res = await POST(req({ email: "login-test@example.com", password: "wrong-password" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 and sets a session cookie for correct credentials", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 10);
    const user = await db.user.create({
      data: { isGuest: false, email: "login-ok@example.com", passwordHash, lastActiveAt: new Date() },
    });
    createdUserIds.push(user.id);

    const { POST } = await import("./route");
    const res = await POST(req({ email: "login-ok@example.com", password: "correct-password" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(user.id);
    expect(setCookie).toHaveBeenCalledWith("session", expect.any(String), expect.any(Object));
  });
});
