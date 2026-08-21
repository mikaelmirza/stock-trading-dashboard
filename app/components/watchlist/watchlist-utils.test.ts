import { describe, expect, it } from "vitest";
import { getAddableSymbols } from "./watchlist-utils";
import { SYMBOLS } from "@/app/lib/symbols";

describe("getAddableSymbols", () => {
  it("returns all curated symbols when the watchlist is empty", () => {
    expect(getAddableSymbols([])).toEqual([...SYMBOLS]);
  });

  it("excludes symbols already in the watchlist", () => {
    const result = getAddableSymbols(["AAPL", "MSFT"]);
    expect(result).not.toContain("AAPL");
    expect(result).not.toContain("MSFT");
    expect(result).toHaveLength(SYMBOLS.length - 2);
  });

  it("ignores symbols that aren't in the curated universe", () => {
    const result = getAddableSymbols(["NOTREAL"]);
    expect(result).toEqual([...SYMBOLS]);
  });
});
