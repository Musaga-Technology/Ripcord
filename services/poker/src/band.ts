// When a poker wakes the sealed checker (docs/SPEC.md §4). Pokers see only public Hyperliquid data; the sealed
// line lives in the enclave, so they call inside a wide public band and the checker decides privately.

export interface WatchState {
  /** Distance to liquidation now, in %, computed locally every second. */
  distance: number;
  /** Distance at the last checker call. */
  lastCheckedDistance: number | null;
  lastCheckAt: number;
  now: number;
  /** Distance fell over the last few seconds. */
  falling: boolean;
  /** Mark price now, and the public liquidation price from before a pending rescue, if any. */
  mark: number;
  pendingLiqBefore: number | null;
  /** A rescue was just reported and needs recording. */
  justRescued: boolean;
}

export interface BandConfig {
  bandPct: number;
  minDropPp: number;
  burstMs: number;
  heartbeatMs: number;
  settlementPct: number;
}

export const DEFAULT_BAND: BandConfig = {
  bandPct: 30,
  minDropPp: 0.5,
  burstMs: 3_000,
  heartbeatMs: 3_600_000,
  settlementPct: 0.5,
};

export type CallReason = 'after-rescue' | 'settlement' | 'band-drop' | 'band-falling' | 'heartbeat';

export function callReason(s: WatchState, c: BandConfig = DEFAULT_BAND): CallReason | null {
  const since = s.now - s.lastCheckAt;
  if (s.justRescued) return 'after-rescue';
  if (s.pendingLiqBefore !== null && (Math.abs(s.mark - s.pendingLiqBefore) / s.pendingLiqBefore) * 100 <= c.settlementPct)
    return 'settlement';
  const inBand = s.distance < c.bandPct;
  if (inBand && (s.lastCheckedDistance === null || s.lastCheckedDistance - s.distance >= c.minDropPp)) return 'band-drop';
  if (inBand && s.falling && since >= c.burstMs) return 'band-falling';
  if (since >= c.heartbeatMs) return 'heartbeat';
  return null;
}
