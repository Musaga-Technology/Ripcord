// The guard in the browser: one isolated Hyperliquid position, guarded by the same decision functions the enclave
// runs (`@ripcord/shared`: fallRate, shouldFire, speedTarget, rescueSize, settle). Prices are simulated; the rules
// are not. Used by the hero's live view and the hunt simulator.
import { draw, fallRate, rescueSize, settle, shouldFire, speedTarget } from '@ripcord/shared';

/** Mulberry32: a small seeded generator, so a run can be replayed exactly. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw from two uniforms (Box–Muller). */
export function gauss(u: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

export interface PositionSpec {
  /** +1 long, −1 short. */
  side: 1 | -1;
  entry: number;
  notional: number;
  leverage: number;
  /** Maintenance fraction: 1 / (2 × max leverage). ETH: 2 %. */
  mm: number;
}

/** Isolated liquidation price: equity equals maintenance. */
export function liqPrice(p: PositionSpec, margin: number): number {
  const size = p.notional / p.entry;
  return p.side > 0 ? (p.entry * size - margin) / (size * (1 - p.mm)) : (p.entry * size + margin) / (size * (1 + p.mm));
}

export const distance = (liq: number, mark: number) => (Math.abs(liq - mark) / mark) * 100;

export type GuardPhase = 'guarded' | 'rescuing' | 'rescued' | 'liquidated';

export interface GuardSpec {
  /** Sealed ranges, % from liquidation. */
  lineRange: [number, number];
  targetRange: [number, number];
  speedAware: boolean;
  /** The reserve as a multiple of the starting margin. */
  reserveX: number;
  /** Seconds from firing to the credit landing (mainnet test rescues: 27–46 s). */
  landS: number;
  cooldownS: number;
}

export interface RescueEvent {
  firedAt: number;
  landedAt: number | null;
  amount: number;
  liqBefore: number;
  /** The line in force when it fired: sealed, shown only at the end of a hunt. */
  line: number;
  outcome: 'pending' | 'saved' | 'early' | 'failed';
}

/**
 * A guarded position stepped through simulated time. `observe(t, price)` is one check: it lands a credit that is
 * due, then decides with the shared rules whether to fire, exactly as `checker/src/check.rs` does.
 */
export class GuardedPosition {
  readonly margin0: number;
  margin: number;
  liq: number;
  line: number;
  target: number;
  left: number;
  phase: GuardPhase = 'guarded';
  rescues: RescueEvent[] = [];
  private history: [number, number][] = [];
  private readyAt = 0;

  constructor(
    readonly pos: PositionSpec,
    readonly guard: GuardSpec,
    private readonly u: () => number,
  ) {
    this.margin0 = pos.notional / pos.leverage;
    this.margin = this.margin0;
    this.liq = liqPrice(pos, this.margin);
    this.left = guard.reserveX * this.margin0;
    [this.line, this.target] = this.arm();
  }

  private arm(): [number, number] {
    const [l0, l1] = this.guard.lineRange;
    const [t0, t1] = this.guard.targetRange;
    return [draw(l0, l1, this.u()), draw(t0, t1, this.u())];
  }

  get inFlight(): RescueEvent | undefined {
    return this.rescues.find((r) => r.landedAt === null);
  }

  /** Did this price touch the liquidation price? (tested on every tick, like each bar's extreme in the harness) */
  touched(price: number): boolean {
    return this.pos.side > 0 ? price <= this.liq : price >= this.liq;
  }

  observe(t: number, price: number): 'fired' | 'landed' | 'liquidated' | null {
    if (this.phase === 'liquidated') return null;
    if (this.touched(price)) {
      this.phase = 'liquidated';
      for (const r of this.rescues) if (r.outcome === 'pending') r.outcome = 'failed';
      return 'liquidated';
    }
    let event: 'fired' | 'landed' | null = null;
    const f = this.inFlight;
    if (f && t >= f.firedAt + this.guard.landS) {
      f.landedAt = t;
      this.margin += f.amount;
      this.liq = liqPrice(this.pos, this.margin);
      this.readyAt = t + this.guard.cooldownS;
      this.phase = 'rescued';
      [this.line, this.target] = this.arm(); // every rescue redraws the line
      event = 'landed';
    }
    for (const r of this.rescues) {
      if (r.outcome !== 'pending' || r.landedAt === null) continue;
      const o = settle(this.pos.side, r.liqBefore, price, false, t - r.firedAt);
      if (o !== 'pending') r.outcome = o;
    }
    const d = distance(this.liq, price);
    this.history = this.history.filter(([ts]) => t - ts <= 60);
    const v = fallRate(this.history, t, d);
    this.history.push([t, d]);
    if (this.phase === 'rescued' && t >= this.readyAt) this.phase = 'guarded';
    if (this.inFlight || t < this.readyAt || this.left < 5) return event;
    if (!shouldFire(d, this.line, this.guard.speedAware, v)) return event;
    const size = this.pos.notional / this.pos.entry;
    const amount = rescueSize({
      drawn_target: speedTarget(this.target, this.guard.speedAware, v),
      distance: d,
      mark: price,
      szi: this.pos.side * size,
      maint_frac: this.pos.mm,
      max_rescue_usd: this.left,
      budget_left_usd: this.left,
      reserve_usd: this.left,
    });
    if (amount === null) return event;
    this.left -= amount;
    this.rescues.push({ firedAt: t, landedAt: null, amount, liqBefore: this.liq, line: this.line, outcome: 'pending' });
    this.phase = 'rescuing';
    return 'fired';
  }
}
