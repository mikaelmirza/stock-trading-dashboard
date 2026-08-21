import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

function params(symbol: string) {
  return { params: Promise.resolve({ symbol }) };
}

describe("DELETE /api/watchlist/[symbol]", () => {
  let userId: string;

  afterEach(async () => {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    cookieValue = undefined;
  });

  it("returns 401 with no session", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), params("AAPL"));
    expect(res.status).toBe(401);
  });

  it("removes the item and returns 204", async () => {
    const user = await db.user.create({
      data: {
        isGuest: true,
        lastActiveAt: new Date(),
        watchlist: { create: [{ symbol: "AAPL" }] },
      },
    });
    userId = user.id;
    cookieValue = await encrypt({ userId });

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), params("AAPL"));
    expect(res.status).toBe(204);

    const remaining = await db.watchlistItem.findMany({ where: { userId } });
    expect(remaining).toHaveLength(0);
  });
});
