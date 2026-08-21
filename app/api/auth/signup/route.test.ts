import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;
const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
    set: setCookie,
    delete: vi.fn(),
  }),
}));

function req(body: unknown) {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/signup", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    if (createdUserIds.length) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
    cookieValue = undefined;
    setCookie.mockClear();
  });

  it("returns 401 with no session", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ email: "a@example.com", password: "password123" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid input", async () => {
    const guest = await db.user.create({ data: { isGuest: true, lastActiveAt: new Date() } });
    createdUserIds.push(guest.id);
    cookieValue = await encrypt({ userId: guest.id });

    const { POST } = await import("./route");
    const res = await POST(req({ email: "not-an-email", password: "short" }));
    expect(res.status).toBe(400);
  });

  it("upgrades the guest's row in place, keeping the same id", async () => {
    const guest = await db.user.create({ data: { isGuest: true, lastActiveAt: new Date() } });
    createdUserIds.push(guest.id);
    cookieValue = await encrypt({ userId: guest.id });

    const { POST } = await import("./route");
    const res = await POST(req({ email: "signup-test@example.com", password: "password123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(guest.id);

    const updated = await db.user.findUniqueOrThrow({ where: { id: guest.id } });
    expect(updated.isGuest).toBe(false);
    expect(updated.email).toBe("signup-test@example.com");
  });

  it("rejects a duplicate email with 409", async () => {
    const existing = await db.user.create({
      data: {
        isGuest: false,
        email: "taken@example.com",
        passwordHash: "x",
        lastActiveAt: new Date(),
      },
    });
    createdUserIds.push(existing.id);
    const guest = await db.user.create({ data: { isGuest: true, lastActiveAt: new Date() } });
    createdUserIds.push(guest.id);
    cookieValue = await encrypt({ userId: guest.id });

    const { POST } = await import("./route");
    const res = await POST(req({ email: "taken@example.com", password: "password123" }));
    expect(res.status).toBe(409);
  });
});
