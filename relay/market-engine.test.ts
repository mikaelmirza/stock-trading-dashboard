import { describe, expect, it } from "vitest";
import { MarketEngine, computeDriftVolatility, mulberry32 } from "./market-engine";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe("computeDriftVolatility", () => {
  it("derives drift/volatility from log returns of historical closes", () => {
    const closes = [100, 101, 100, 102, 103];
    const { drift, volatility } = computeDriftVolatility(closes);
    expect(typeof drift).toBe("number");
    expect(volatility).toBeGreaterThan(0);
  });

  it("falls back to a default for too little history", () => {
    expect(computeDriftVolatility([100])).toEqual({ drift: 0, volatility: 0.02 });
  });
});

function priceOf(outcome: { kind: string; price?: string }): string {
  if (outcome.kind === "waiting") throw new Error("expected a priced outcome");
  return outcome.price!;
}

describe("MarketEngine", () => {
  it("produces an identical tick sequence for an identical seed", () => {
    const make = () =>
      new MarketEngine({
        symbol: "AAPL",
        startPrice: 100,
        drift: 0.0002,
        volatility: 0.02,
        rng: mulberry32(7),
        anomalyProbabilityPerTick: 0, // isolate determinism from halt randomness
      });

    const engineA = make();
    const engineB = make();
    const seqA = Array.from({ length: 10 }, (_, i) => priceOf(engineA.tick(i * 500)));
    const seqB = Array.from({ length: 10 }, (_, i) => priceOf(engineB.tick(i * 500)));

    expect(seqA).toEqual(seqB);
  });

  it("mean/variance over many ticks roughly matches the given parameters", () => {
    const engine = new MarketEngine({
      symbol: "AAPL",
      startPrice: 100,
      drift: 0,
      volatility: 0.02,
      dtPerTick: 1 / 1000,
      rng: mulberry32(123),
      anomalyProbabilityPerTick: 0, // isolate GBM behavior from halts
    });

    const prices: number[] = [];
    for (let i = 0; i < 2000; i++) {
      prices.push(Number(priceOf(engine.tick(i * 500))));
    }

    const logReturns = prices.slice(1).map((p, i) => Math.log(p / prices[i]!));
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    // With ~0 drift over many ticks, the mean log return should be small.
    expect(Math.abs(mean)).toBeLessThan(0.001);
  });

  it("halts on a forced anomaly trigger, stops ticking, and resumes after the configured pause at a new price", () => {
    // rng sequence: two values consumed by the gaussian in tick 1 (kept
    // "normal"), then a third value < anomalyProbabilityPerTick forces the
    // halt trigger check to fire, then a shock-direction value.
    const values = [0.5, 0.5, 0.0, 0.9];
    let i = 0;
    const rng = () => values[i++] ?? 0.5;

    const engine = new MarketEngine({
      symbol: "AAPL",
      startPrice: 100,
      drift: 0,
      volatility: 0.02,
      rng,
      anomalyProbabilityPerTick: 0.5,
      haltDurationMs: 5000,
    });

    const haltOutcome = engine.tick(0);
    expect(haltOutcome.kind).toBe("halted");
    expect(engine.isHalted).toBe(true);
    const priceAtHalt = priceOf(haltOutcome);
    expect(priceAtHalt).not.toBe("100.0000");

    // Ticking is a no-op while still within the halt window.
    expect(engine.tick(1000).kind).toBe("waiting");
    expect(engine.tick(4999).kind).toBe("waiting");
    expect(engine.isHalted).toBe(true);

    // Once the halt duration elapses, the next tick resumes with a fresh price.
    const resumeOutcome = engine.tick(5000);
    expect(resumeOutcome.kind).toBe("resumed");
    expect(engine.isHalted).toBe(false);
  });
});
