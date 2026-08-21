import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

describe("GET /api/holdings", () => {
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

  it("returns the user's holdings", async () => {
    const user = await db.user.create({
      data: {
        isGuest: true,
        lastActiveAt: new Date(),
        holdings: { create: [{ symbol: "AAPL", quantity: 5, avgCostBasis: "150.0000" }] },
      },
    });
    userId = user.id;
    cookieValue = await encrypt({ userId });

    const { GET } = await import("./route");
    const res = await GET();
    const holdings = await res.json();
    expect(holdings).toHaveLength(1);
    expect(holdings[0].symbol).toBe("AAPL");
    expect(holdings[0].quantity).toBe(5);
  });
});
