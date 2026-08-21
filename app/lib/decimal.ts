import Decimal from "decimal.js";

export { Decimal };

// Money fields cross the wire as Decimal-serialized strings (PLAN §3, to
// avoid float precision loss over JSON) — this is the type alias for those
// string-typed fields, both API responses and props like MarketData.price.
export type Money = string;

export function toDecimal(value: Money | number | Decimal): Decimal {
  return new Decimal(value);
}

export function add(a: Money | number, b: Money | number): Decimal {
  return new Decimal(a).plus(b);
}

export function subtract(a: Money | number, b: Money | number): Decimal {
  return new Decimal(a).minus(b);
}

export function multiply(a: Money | number, b: Money | number): Decimal {
  return new Decimal(a).times(b);
}

export function divide(a: Money | number, b: Money | number): Decimal {
  return new Decimal(a).dividedBy(b);
}

export function isGreaterThan(a: Money | number, b: Money | number): boolean {
  return new Decimal(a).greaterThan(b);
}

// Display formatting only — never round-trip a formatted string back into
// money math (it loses precision by design, e.g. "$1,234.50").
export function formatMoney(value: Money | number | Decimal): string {
  const decimal = new Decimal(value);
  const [whole, fraction = "00"] = decimal.toFixed(2).split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${decimal.isNegative() ? "-$" : "$"}${withCommas.replace("-", "")}.${fraction}`;
}
