import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { SYMBOLS } from "@/app/lib/symbols";

describe("GET /api/symbols", () => {
  it("returns the curated symbol universe", async () => {
    const res = await GET();
    expect(await res.json()).toEqual([...SYMBOLS]);
  });
});
