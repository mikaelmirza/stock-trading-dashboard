import { describe, expect, it } from "vitest";
import { add, divide, formatMoney, isGreaterThan, multiply, subtract } from "./decimal";

describe("add", () => {
  it("produces exact results for float-unsafe inputs", () => {
    expect(add(0.1, 0.2).toString()).toBe("0.3");
    expect(add("100000.10", "0.20").toString()).toBe("100000.3");
  });
});

describe("subtract/multiply/divide", () => {
  it("are decimal-exact", () => {
    expect(subtract("10.00", "0.01").toString()).toBe("9.99");
    expect(multiply("19.99", 3).toString()).toBe("59.97");
    expect(divide("100", 3).toFixed(4)).toBe("33.3333");
  });
});

describe("isGreaterThan", () => {
  it("compares decimal-exact", () => {
    expect(isGreaterThan("100000.10", "100000.09")).toBe(true);
    expect(isGreaterThan("100000.09", "100000.10")).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats with a dollar sign and two decimals", () => {
    expect(formatMoney("99.5")).toBe("$99.50");
    expect(formatMoney(100)).toBe("$100.00");
  });

  it("adds thousands separators", () => {
    expect(formatMoney("100000")).toBe("$100,000.00");
    expect(formatMoney("1234567.89")).toBe("$1,234,567.89");
  });

  it("formats negative values", () => {
    expect(formatMoney("-42.5")).toBe("-$42.50");
  });
});
