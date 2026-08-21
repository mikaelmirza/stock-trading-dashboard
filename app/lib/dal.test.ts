import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

describe("verifySession / getUser", () => {
  let userId: string;

  beforeEach(async () => {
    cookieValue = undefined;
    const user = await db.user.create({
      data: { isGuest: true, lastActiveAt: new Date() },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await db.user.deleteMany({ where: { id: userId } });
    vi.resetModules();
  });

  it("returns null when there is no session cookie", async () => {
    const { verifySession } = await import("./dal");
    expect(await verifySession()).toBeNull();
  });

  it("resolves the user for a valid session cookie", async () => {
    cookieValue = await encrypt({ userId });
    const { verifySession, getUser } = await import("./dal");
    expect(await verifySession()).toEqual({ userId });
    const user = await getUser();
    expect(user?.id).toBe(userId);
  });

  it("returns null when the session references a deleted user", async () => {
    cookieValue = await encrypt({ userId: "does_not_exist" });
    const { verifySession } = await import("./dal");
    expect(await verifySession()).toBeNull();
  });

  it("does not touch lastActiveAt for a fresh session", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    cookieValue = await encrypt({ userId });
    const { verifySession } = await import("./dal");
    await verifySession();
    const after = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.lastActiveAt.getTime()).toBe(before.lastActiveAt.getTime());
  });

  it("touches lastActiveAt when it is more than an hour stale", async () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.user.update({ where: { id: userId }, data: { lastActiveAt: stale } });
    cookieValue = await encrypt({ userId });
    const { verifySession } = await import("./dal");
    await verifySession();
    const after = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.lastActiveAt.getTime()).toBeGreaterThan(stale.getTime());
  });
});
