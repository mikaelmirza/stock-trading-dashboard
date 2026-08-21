import { Decimal } from "decimal.js";

// Deterministic PRNG (mulberry32) so a given seed always produces the same
// tick sequence (SPEC §10) — Math.random() can't be seeded, so it's only
// used as the default, not the only option.
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derives daily drift/volatility from real historical closes (SPEC §4) via
// the mean/stddev of daily log returns — this is what makes AAPL "feel"
// less volatile than a smaller-cap name, rather than every symbol sharing
// one arbitrary volatility constant.
export function computeDriftVolatility(
  closes: readonly number[]
): { drift: number; volatility: number } {
  if (closes.length < 2) {
    return { drift: 0, volatility: 0.02 };
  }
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i]! / closes[i - 1]!));
  }
  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
  const variance =
    logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / logReturns.length;
  return { drift: mean, volatility: Math.sqrt(variance) };
}

export type TickOutcome =
  | { kind: "tick"; price: string }
  | { kind: "halted"; price: string }
  | { kind: "waiting" }
  | { kind: "resumed"; price: string };

export interface MarketEngineOptions {
  symbol: string;
  startPrice: number;
  drift: number;
  volatility: number;
  /** Fraction of a trading day advanced per tick — small so visible movement stays gradual at a 250-1000ms tick cadence. */
  dtPerTick?: number;
  /** Uniform [0,1) source — injectable for deterministic tests. */
  rng?: () => number;
  /** Per-tick probability of a trading-halt anomaly event. */
  anomalyProbabilityPerTick?: number;
  haltDurationMs?: number;
  /** Restore from a persisted halt state on relay restart (SPEC §9 continuity). */
  startHalted?: boolean;
}

// One symbol's live price simulator: a GBM random walk seeded from real
// drift/volatility, plus occasional trading-halt anomaly events (SPEC §4).
// Owns pricing/halt *decisions*; the caller (relay/connection-manager.ts)
// owns *timing* — tick() takes the current time as a parameter rather than
// scheduling its own timers, so both tick cadence and halt-resume timing
// are driven by one clock the caller controls (and can fake in tests).
export class MarketEngine {
  readonly symbol: string;
  private price: Decimal;
  private halted: boolean;
  private haltedUntil = 0;
  private readonly drift: number;
  private readonly volatility: number;
  private readonly dtPerTick: number;
  private readonly rng: () => number;
  private readonly anomalyProbabilityPerTick: number;
  private readonly haltDurationMs: number;

  constructor(options: MarketEngineOptions) {
    this.symbol = options.symbol;
    this.price = new Decimal(options.startPrice);
    this.drift = options.drift;
    this.volatility = options.volatility;
    this.dtPerTick = options.dtPerTick ?? 1 / 1000;
    this.rng = options.rng ?? Math.random;
    this.anomalyProbabilityPerTick = options.anomalyProbabilityPerTick ?? 0.0005;
    this.haltDurationMs = options.haltDurationMs ?? 5000;
    this.halted = options.startHalted ?? false;
    // An unknown-duration inherited halt just waits for the next natural
    // anomaly-free tick's clock to clear it eventually; not modeled further
    // since a restart mid-halt is a narrow edge case (SPEC §9's continuity
    // guarantee is about price, not halt-countdown, resuming exactly).
  }

  get isHalted(): boolean {
    return this.halted;
  }

  getState(): { price: string; isHalted: boolean } {
    return { price: this.price.toFixed(4), isHalted: this.halted };
  }

  tick(now: number = Date.now()): TickOutcome {
    if (this.halted) {
      if (now < this.haltedUntil) {
        return { kind: "waiting" };
      }
      this.halted = false;
      // Resuming is itself a real tick — apply normal GBM movement from
      // the (already shock-adjusted) halted price rather than reporting a
      // stale price with no movement.
      this.applyGbmStep();
      return { kind: "resumed", price: this.price.toFixed(4) };
    }

    this.applyGbmStep();

    if (this.rng() < this.anomalyProbabilityPerTick) {
      this.halted = true;
      this.haltedUntil = now + this.haltDurationMs;
      // The halt itself carries a sharp move (SPEC §4) — up to +/-5%,
      // applied once, so the transition reads as "a shock happened," not
      // just "ticking silently stopped."
      const shockFraction = (this.rng() - 0.5) * 0.1;
      this.price = new Decimal(this.price.toNumber() * (1 + shockFraction)).toDecimalPlaces(4);
      return { kind: "halted", price: this.price.toFixed(4) };
    }

    return { kind: "tick", price: this.price.toFixed(4) };
  }

  private applyGbmStep(): void {
    const z = this.gaussianRandom();
    const change =
      (this.drift - 0.5 * this.volatility ** 2) * this.dtPerTick +
      this.volatility * Math.sqrt(this.dtPerTick) * z;
    this.price = new Decimal(this.price.toNumber() * Math.exp(change)).toDecimalPlaces(4);
  }

  private gaussianRandom(): number {
    // Box-Muller transform from two uniform samples.
    const u1 = Math.max(this.rng(), Number.EPSILON);
    const u2 = this.rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
