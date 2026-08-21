import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/app/lib/db";
import { encrypt } from "@/app/lib/session";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

function postReq(body: unknown) {
  return new Request("http://localhost/api/watchlist", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET/POST /api/watchlist", () => {
  let userId: string;

  afterEach(async () => {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    cookieValue = undefined;
  });

  async function loginAsFreshGuest() {
    const user = await db.user.create({ data: { isGuest: true, lastActiveAt: new Date() } });
    userId = user.id;
    cookieValue = await encrypt({ userId });
    return user;
  }

  it("GET returns 401 with no session", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET returns an empty array for a new user", async () => {
    await loginAsFreshGuest();
    const { GET } = await import("./route");
    const res = await GET();
    expect(await res.json()).toEqual([]);
  });

  it("POST adds a curated symbol and GET reflects it", async () => {
    await loginAsFreshGuest();
    const { GET, POST } = await import("./route");

    const postRes = await POST(postReq({ symbol: "AAPL" }));
    expect(postRes.status).toBe(201);

    const getRes = await GET();
    const items = await getRes.json();
    expect(items.map((i: { symbol: string }) => i.symbol)).toEqual(["AAPL"]);
  });

  it("POST rejects a non-curated symbol with 422", async () => {
    await loginAsFreshGuest();
    const { POST } = await import("./route");
    const res = await POST(postReq({ symbol: "NOTREAL" }));
    expect(res.status).toBe(422);
  });

  it("POST rejects a duplicate with 409", async () => {
    await loginAsFreshGuest();
    const { POST } = await import("./route");
    await POST(postReq({ symbol: "AAPL" }));
    const res = await POST(postReq({ symbol: "AAPL" }));
    expect(res.status).toBe(409);
  });
});
