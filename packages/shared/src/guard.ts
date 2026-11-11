// The guard's decisions as pure functions (docs/SPEC.md §3 "One check"). The checker runs the Rust twin
// (checker/src/guard.rs) inside the enclave; the web app and the replay harness use this one. Distances are in %.
import type { Outcome, Position, Preset } from './types';

/** Line and target as fractions of the position's distance from liquidation at setup (docs/ARCHITECTURE.md §4.2). */
export const PRESET_FRACTIONS: Record<Preset, [number, number]> = {
  safer: [0.75, 1.1],
  balanced: [0.6, 1.0],
  lean: [0.45, 0.9],
};
/** The sealed ranges' half-width around a preset's line and target, as a fraction of each. */
export const RANGE_WIDTH = 0.15;

export interface PresetRanges {
  line_range_pct: [number, number];
  target_range_pct: [number, number];
}

const round2 = (x: number) => Math.floor(x * 100 + 0.5) / 100;

/** A preset's sealed ranges for a position `d0` % from liquidation; null if they wouldn't pass the checker. */
export function presetRanges(preset: Preset, d0: number): PresetRanges | null {
  const [lf, tf] = PRESET_FRACTIONS[preset];
  const [line, target] = [lf * d0, tf * d0];
  const lo = round2(line * (1 - RANGE_WIDTH));
  const hi = Math.min(round2(line * (1 + RANGE_WIDTH)), 50);
  const tlo = round2(target * (1 - RANGE_WIDTH));
  const thi = Math.min(round2(target * (1 + RANGE_WIDTH)), 80);
  if (lo < 0.5 || lo > hi || tlo <= hi || tlo > thi) return null;
  return { line_range_pct: [lo, hi], target_range_pct: [tlo, thi] };
}

export function distancePct(liquidationPx: number | null, mark: number): number | null {
  if (liquidationPx === null) return null;
  return (Math.abs(liquidationPx - mark) / mark) * 100;
}

/** Mark price from `clearinghouseState` alone (weight 2): positionValue / |szi|. */
export function markOf(p: Position): number {
  return p.position_value / Math.abs(p.szi);
}

/** The minimum over cross positions, or the isolated coin's distance; null if nothing is at risk. */
export function guardDistance(positions: Position[], isolatedCoin: string | null): number | null {
  let min: number | null = null;
  for (const p of positions) {
    if (isolatedCoin !== null ? p.coin !== isolatedCoin : p.leverage_type !== 'cross') continue;
    const d = distancePct(p.liquidation_px, markOf(p));
    if (d !== null && (min === null || d < min)) min = d;
  }
  return min;
}

/** How fast the distance is falling, in percentage points per second, over the last `windowS` seconds (≥ 0). */
export function fallRate(history: [number, number][], nowT: number, nowD: number, windowS = 60): number {
  let first: [number, number] | null = null;
  for (const pt of history) {
    if (nowT - pt[0] > windowS) continue;
    if (first === null || pt[0] < first[0] || (pt[0] === first[0] && pt[1] < first[1])) first = pt;
  }
  if (first === null) return 0;
  const span = nowT - first[0];
  if (span < 1) return 0;
  return Math.max(0, (first[1] - nowD) / span);
}

/** Fire below the drawn line, or (speed-aware) when the fall rate would cross it within the rescue time. */
export function shouldFire(
  distance: number,
  drawnLine: number,
  speedAware: boolean,
  v: number,
  horizonS = 60,
): boolean {
  if (distance < drawnLine) return true;
  return speedAware && distance - v * horizonS < drawnLine;
}

/**
 * A speed-aware rescue tops up past the drawn target by this many times the fall expected while the credit lands
 * (tuned on Oct 2025 – Jun 2026 replays: fewer liquidations and fewer, larger rescues than topping up to the target).
 */
export const SPEED_BOOST = 3;

export function speedTarget(drawnTarget: number, speedAware: boolean, v: number, horizonS = 60): number {
  return drawnTarget + (speedAware ? SPEED_BOOST * v * horizonS : 0);
}

export interface SizeInput {
  drawn_target: number;
  distance: number;
  mark: number;
  szi: number;
  maint_frac: number;
  max_rescue_usd: number;
  budget_left_usd: number;
  reserve_usd: number;
}

/** The smallest rescue the private route to Hyperliquid carries ($2 lands $1.68 in about 20 s; $1 is refused). */
export const MIN_RESCUE_USD = 2;

/**
 * USDC needed to lift the distance to the drawn target, at least the route's minimum (a small position gets the
 * minimum rather than no rescue), within the cap, the budget left and the reserve; null when they allow less than
 * the minimum.
 */
export function rescueSize(i: SizeInput): number | null {
  const side = i.szi > 0 ? 1 : -1;
  const need = ((i.drawn_target - i.distance) / 100) * i.mark * Math.abs(i.szi) * (1 - i.maint_frac * side);
  const room = Math.min(i.max_rescue_usd, i.budget_left_usd, i.reserve_usd);
  return room < MIN_RESCUE_USD ? null : Math.min(Math.max(need, MIN_RESCUE_USD), room);
}

/** 3 % of a saved rescue, 0.5 % on any part above $50,000 (PRD §7). */
export function saveFee(t: number): number {
  return 0.03 * Math.min(t, 50000) + 0.005 * Math.max(t - 50000, 0);
}

const roundHalfUp = (x: number) => Math.floor(x + 0.5);

/** Public receipts carry the credit to 2 significant figures: 1,486.18 → 1,500; 640 → 640. */
export function roundCredit(x: number): number {
  if (x <= 0) return 0;
  const p = Math.floor(Math.log10(x)) - 1;
  if (p >= 0) return roundHalfUp(x / 10 ** p) * 10 ** p;
  return roundHalfUp(x * 10 ** -p) / 10 ** -p;
}

export const atHour = (atS: number) => Math.floor(atS / 3600) * 3600;
export const latencyS = (seconds: number) => roundHalfUp(seconds);

/** A point inside a sealed range from enclave randomness u ∈ [0, 1). */
export const draw = (lo: number, hi: number, u: number) => lo + u * (hi - lo);

/** Settle a rescue: saved if the mark later crossed the liquidation price from before it. */
export function settle(szi: number, liqBefore: number, mark: number, liquidated: boolean, ageS: number): Outcome {
  if (liquidated) return 'failed';
  if ((szi > 0 && mark <= liqBefore) || (szi < 0 && mark >= liqBefore)) return 'saved';
  return ageS >= 86400 ? 'early' : 'pending';
}
