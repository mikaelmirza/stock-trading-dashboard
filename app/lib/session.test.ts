import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./session";

describe("encrypt/decrypt", () => {
  it("round-trips a payload exactly", async () => {
    const token = await encrypt({ userId: "user_123" });
    const session = await decrypt(token);
    expect(session?.userId).toBe("user_123");
    expect(typeof session?.expiresAt).toBe("number");
  });

  it("fails to decrypt a tampered token", async () => {
    const token = await encrypt({ userId: "user_123" });
    const tampered = token.slice(0, -2) + (token.at(-2) === "a" ? "b" : "a") + token.at(-1);
    expect(await decrypt(tampered)).toBeUndefined();
  });

  it("fails to decrypt garbage input", async () => {
    expect(await decrypt("not.a.jwt")).toBeUndefined();
  });

  it("returns undefined for an undefined token", async () => {
    expect(await decrypt(undefined)).toBeUndefined();
  });
});
