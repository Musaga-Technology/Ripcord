// "Try a crash" on an example guard: one position stepped through a simulated fall, through the guard's real rules
// (`GuardedPosition`, the enclave's own decisions). The path is choreographed to test the rescue, as in Home's live
// view, and a reserve too small for it really does end in a liquidation.
import { MIN_RESCUE_USD } from '@ripcord/shared';
import { gauss, GuardedPosition, rng, type GuardSpec, type PositionSpec } from './sim';

/** Margin that puts the liquidation price where Hyperliquid shows it: the inverse of `liqPrice`. */
export function marginFor(side: 1 | -1, entry: number, notional: number, mm: number, liq: number): number {
  const size = notional / entry;
  return side > 0 ? entry * size - liq * size * (1 - mm) : liq * size * (1 + mm) - entry * size;
}

export class CrashRun {
  t = 0;
  price: number;
  pts: [number, number][] = [];
  crashing = false;
  readonly guard: GuardedPosition;
  /** The liquidation price the position opened the run with: the public line a save is measured against. */
  readonly openLiq: number;
  oldLiq: number | null = null;
  landedAt: number | null = null;
  landedPrice = 0;
  savedAt: number | null = null;
  /** The fall reached its low. The market doesn't stop because a rescue counted as a save. */
  bottomedAt: number | null = null;
  private readonly u: () => number;

  constructor(
    readonly pos: PositionSpec,
    readonly spec: GuardSpec,
    readonly seed: number,
    readonly windowS = 300,
  ) {
    this.u = rng(seed);
    this.guard = new GuardedPosition(pos, spec, this.u);
    this.openLiq = this.guard.liq;
    this.price = pos.entry;
    this.pts = [[0, this.price]];
    for (let i = 0; i < windowS; i++) this.step();
  }

  /** One simulated second, with a check every 3 s. */
  step(): void {
    const g = this.guard;
    const s = this.pos.side;
    const f = g.inFlight;
    let target = this.pos.entry;
    let k = 0.02;
    if (this.crashing && g.phase !== 'liquidated' && this.bottomedAt === null) {
      if (this.landedAt !== null && this.oldLiq !== null) {
        target = this.oldLiq * (1 - s * 0.012); // the wick goes past the old liquidation price
        k = 0.045;
        if (s * (this.price - target) <= target * 0.001) this.bottomedAt = this.t;
      } else if (f) {
        target = f.liqBefore * (1 + s * 0.012);
        k = 0.03;
      } else {
        // Down to the guard's line, and past the liquidation price once the reserve can't pay for another rescue.
        target = g.left < MIN_RESCUE_USD ? g.liq * (1 - s * 0.012) : g.liq * (1 + s * 0.02);
        k = 0.03;
      }
    }
    this.price += k * (target - this.price) + 0.0006 * this.price * gauss(this.u);
    if (f) this.price = s > 0 ? Math.max(this.price, g.liq * 1.004) : Math.min(this.price, g.liq * 0.996);
    this.t += 1;
    this.pts.push([this.t, this.price]);
    while (this.pts.length && this.pts[0]![0] < this.t - this.windowS - 5) this.pts.shift();
    if (this.t % 3 !== 0) return;
    const before = g.liq;
    const ev = g.observe(this.t, this.price);
    if (ev === 'landed') {
      this.oldLiq = before;
      this.landedAt = this.t;
      this.landedPrice = this.price;
    }
    if (this.savedAt === null && g.rescues.some((r) => r.outcome === 'saved')) this.savedAt = this.t;
  }

  /**
   * Every price and liquidation price this run will show if the crash starts now: the same seed gives the same run,
   * so a twin played to the end tells the chart its range before anything moves.
   */
  forecast(): number[] {
    const twin = new CrashRun(this.pos, this.spec, this.seed, this.windowS);
    while (twin.t < this.t) twin.step();
    twin.crashing = true;
    const seen = this.pts.map((p) => p[1]).concat(this.guard.liq);
    for (let i = 0; i < 3000 && !twin.over; i++) {
      twin.step();
      seen.push(twin.price, twin.guard.liq);
    }
    return seen;
  }

  get over(): boolean {
    return this.guard.phase === 'liquidated' || (this.bottomedAt !== null && this.t > this.bottomedAt + 30);
  }
}
