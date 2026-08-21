import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { encrypt } from "./app/lib/session";
import proxy from "./proxy";

describe("proxy", () => {
  it("redirects /dashboard to / when no session cookie is present", async () => {
    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = await proxy(req);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("passes through /dashboard when a valid session cookie is present", async () => {
    const token = await encrypt({ userId: "user_123" });
    const req = new NextRequest("http://localhost:3000/dashboard", {
      headers: { cookie: `session=${token}` },
    });
    const res = await proxy(req);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects /dashboard when the session cookie is invalid/tampered", async () => {
    const req = new NextRequest("http://localhost:3000/dashboard", {
      headers: { cookie: "session=garbage" },
    });
    const res = await proxy(req);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("passes through non-protected routes regardless of session state", async () => {
    const req = new NextRequest("http://localhost:3000/");
    const res = await proxy(req);
    expect(res.headers.get("location")).toBeNull();
  });
});
