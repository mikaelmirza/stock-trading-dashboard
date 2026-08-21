import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { verifyWsToken } from "./jwt";

const key = new TextEncoder().encode(process.env["WS_JWT_SECRET"]);

describe("verifyWsToken", () => {
  it("accepts a token signed with the shared secret", async () => {
    const token = await new SignJWT({ userId: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(key);

    expect(await verifyWsToken(token)).toEqual({ userId: "user_123" });
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({ userId: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);

    expect(await verifyWsToken(token)).toBeNull();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const wrongKey = new TextEncoder().encode("wrong-secret-wrong-secret-wrong");
    const token = await new SignJWT({ userId: "user_123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(wrongKey);

    expect(await verifyWsToken(token)).toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifyWsToken("not-a-jwt")).toBeNull();
  });
});
