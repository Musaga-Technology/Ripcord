// The landing hero's run: real ETH prices from the Oct 10, 2025 crash (Binance's ETHUSDT perpetual, 1-minute bars, the
// same fixture the replay harness runs in CI), through the guard's real rules (`GuardedPosition`). A 10× long opened
// at 21:00 UTC; the public liquidation price is where an unguarded one dies. Within each minute the price moves from
// the last close to the bar's extreme and on to its close, so the wick is the bar's real low. The rescue lands 38 s
// after it fires, as measured on mainnet.
import { presetRanges } from '@ripcord/shared';
import data from '../data/eth-2025-10-10.json';
import { distance, GuardedPosition, liqPrice, rng, type GuardSpec, type PositionSpec } from './sim';

type Bar = [openMs: number, high: number, low: number, close: number];
const BARS = data.bars as Bar[];
export const SOURCE = data.source;
const T0_MS = BARS[0]![0];

/** One price per second, from the bars. */
export function perSecond(bars: Bar[]): number[] {
  const out: number[] = [];
  let prev = bars[0]![3];
  for (const [, hi, lo, close] of bars) {
    const ext = close < prev ? lo : hi;
    for (let s = 0; s < 60; s++)
      out.push(s < 40 ? prev + (ext - prev) * (s / 40) : ext + (close - ext) * ((s - 40) / 20));
    prev = close;
  }
  return out;
}

const PX = perSecond(BARS);
const MIN = 60;
/** Seconds from 19:30 UTC: the position opens at 21:00, the page starts playing at 21:10 and loops at 21:24, after the wick. */
export const ENTRY_T = 90 * MIN;
export const PLAY_T = 100 * MIN;
export const END_T = 114 * MIN;
export const WINDOW_S = 25 * MIN;

export const POS: PositionSpec = { side: 1, entry: PX[ENTRY_T]!, notional: 32_900, leverage: 10, mm: 0.02 };
const ranges = presetRanges('balanced', distance(liqPrice(POS, POS.notional / POS.leverage), POS.entry))!;
export const GUARD: GuardSpec = {
  lineRange: ranges.line_range_pct,
  targetRange: ranges.target_range_pct,
  speedAware: true,
  reserveX: 1,
  landS: 38,
  cooldownS: 60,
};

/** "21:13:11" UTC for a second of the run. */
export const clockOf = (t: number) => new Date(T0_MS + t * 1000).toISOString().slice(11, 19);

export interface Landing {
  t: number;
  price: number;
  amount: number;
}

export class HeroRun {
  t = ENTRY_T;
  readonly guard = new GuardedPosition(POS, GUARD, rng(7));
  /** The public liquidation price the position opened with: where it dies with no guard. */
  readonly unguardedLiq = this.guard.liq;
  landings: Landing[] = [];
  unguardedAt: number | null = null;
  savedAt: number | null = null;
  feed = 'No margin changes in the last hour';

  constructor() {
    while (this.t < PLAY_T) this.step();
  }

  get price(): number {
    return PX[this.t]!;
  }

  /** The window the chart shows, ending now. */
  pts(): [number, number][] {
    const out: [number, number][] = [];
    for (let s = Math.max(0, this.t - WINDOW_S); s <= this.t; s += 2) out.push([s, PX[s]!]);
    return out;
  }

  get over(): boolean {
    return this.t >= END_T;
  }

  /** One second, with a check every 3 s as the pokers call it. */
  step(): void {
    this.t += 1;
    const p = this.price;
    if (this.unguardedAt === null && p <= this.unguardedLiq) this.unguardedAt = this.t;
    if (this.t % 3 !== 0) return;
    if (this.guard.observe(this.t, p) === 'landed') {
      const r = this.guard.rescues[this.guard.rescues.length - 1]!;
      this.landings.push({ t: this.t, price: p, amount: r.amount });
      this.feed = `${clockOf(this.t)} · Margin added: +${Math.round(r.amount).toLocaleString('en-US')} USDC · from: unknown`;
    }
    if (this.savedAt === null && this.guard.rescues.some((r) => r.outcome === 'saved')) this.savedAt = this.t;
  }

  /** Every price and liquidation price the run will show, from a twin played to the end, so nothing rescales. */
  static range(): [number, number] {
    const twin = new HeroRun();
    const seen: number[] = [];
    for (let s = PLAY_T - WINDOW_S; s <= END_T; s++) seen.push(PX[s]!);
    while (!twin.over) {
      twin.step();
      seen.push(twin.guard.liq);
    }
    seen.push(twin.unguardedLiq);
    const lo = Math.min(...seen);
    const hi = Math.max(...seen);
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }
}
