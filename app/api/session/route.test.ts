import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { DEFAULT_WATCHLIST } from "@/app/lib/symbols";

const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie, get: () => undefined, delete: vi.fn() }),
}));

describe("POST /api/session", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    if (createdUserIds.length) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
    setCookie.mockClear();
  });

  it("creates a guest user with the default watchlist and sets a session cookie", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    const body = await res.json();
    createdUserIds.push(body.userId);

    expect(body.isGuest).toBe(true);
    expect(setCookie).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true })
    );

    const user = await db.user.findUniqueOrThrow({
      where: { id: body.userId },
      include: { watchlist: true },
    });
    expect(user.isGuest).toBe(true);
    expect(user.watchlist.map((w) => w.symbol).sort()).toEqual(
      [...DEFAULT_WATCHLIST].sort()
    );
  });
});
