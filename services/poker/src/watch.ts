// The watch loop: public prices every few seconds, each account's liquidation prices every 60 s (10 s inside the
// band), the distance computed locally, and the sealed checker called when `callReason` says so. A poker never
// learns a guard's line; it only knows when a call might matter.
import { callReason, DEFAULT_BAND, type BandConfig, type CallReason } from './band';
import { nearest, type HlPosition, type Hyperliquid } from './hl';

export interface Guard {
  guardId: string;
  hlAddress: string;
}

export type CheckFn = (guardId: string) => Promise<string>;

export interface Timing {
  midsMs: number;
  stateOutsideMs: number;
  stateInsideMs: number;
  /** At most one check per guard this often: the checker's own Hyperliquid reads share the same IP budget. */
  minCheckMs: number;
  /** How long a pending rescue's pre-rescue liquidation price is watched for a settlement call. */
  settlementWatchMs: number;
  /** A rescue still in flight after this long raises an alert (the credit watchdog, ARCHITECTURE §8). */
  creditWatchdogMs: number;
}

export const DEFAULT_TIMING: Timing = {
  midsMs: 3_000,
  stateOutsideMs: 60_000,
  stateInsideMs: 10_000,
  minCheckMs: 3_000,
  settlementWatchMs: 86_400_000,
  creditWatchdogMs: 90_000,
};

interface Tracked {
  guard: Guard;
  positions: HlPosition[];
  stateAt: number;
  lastCheckAt: number;
  lastCheckedDistance: number | null;
  history: [number, number][];
  pending: { coin: string; liq: number; until: number } | null;
  justRescued: boolean;
  checks: number[];
  /** When the rescue now in flight fired. */
  inFlightSince: number | null;
}

export interface Call {
  guardId: string;
  reason: CallReason;
  status: string;
  ms: number;
  /** Set when a rescue has been in flight longer than the credit watchdog allows. */
  alert?: string;
}

export class Watcher {
  private guards = new Map<string, Tracked>();
  private mids: Record<string, number> = {};
  private midsAt = -Infinity;

  constructor(
    private hl: Hyperliquid,
    private check: CheckFn,
    private band: BandConfig = DEFAULT_BAND,
    private timing: Timing = DEFAULT_TIMING,
  ) {}

  add(guard: Guard): void {
    if (this.guards.has(guard.guardId)) return;
    this.guards.set(guard.guardId, {
      guard,
      positions: [],
      stateAt: -Infinity,
      lastCheckAt: -Infinity,
      lastCheckedDistance: null,
      history: [],
      pending: null,
      justRescued: false,
      checks: [],
      inFlightSince: null,
    });
  }

  remove(guardId: string): boolean {
    return this.guards.delete(guardId);
  }

  list(): Guard[] {
    return [...this.guards.values()].map((t) => t.guard);
  }

  /** What the app shows: when the guard was last checked, and how often today. No address. */
  health(guardId: string, now: number): { last_check_at: number | null; checks_24h: number } | null {
    const t = this.guards.get(guardId);
    if (!t) return null;
    return {
      last_check_at: Number.isFinite(t.lastCheckAt) ? t.lastCheckAt : null,
      checks_24h: t.checks.filter((c) => now - c < 86_400_000).length,
    };
  }

  /** One pass over every guard; call every second. Returns the checker calls it made. */
  async tick(now: number): Promise<Call[]> {
    if (now - this.midsAt >= this.timing.midsMs) {
      this.mids = await this.hl.mids();
      this.midsAt = now;
    }
    const calls: Call[] = [];
    for (const t of this.guards.values()) {
      const call = await this.tickOne(t, now).catch(() => null);
      if (call) calls.push(call);
    }
    return calls;
  }

  private async tickOne(t: Tracked, now: number): Promise<Call | null> {
    const prev = nearest(t.positions, this.mids);
    const inside = prev !== null && prev.distance < this.band.bandPct;
    const due = now - t.stateAt >= (inside || t.justRescued ? this.timing.stateInsideMs : this.timing.stateOutsideMs);
    if (due) {
      t.positions = await this.hl.state(t.guard.hlAddress);
      t.stateAt = now;
    }
    const at = nearest(t.positions, this.mids);
    if (t.pending && now > t.pending.until) t.pending = null;
    t.history = t.history.filter(([ts]) => now - ts <= 3_000);
    const falling = at !== null && t.history.length > 0 && t.history[0]![1] > at.distance;
    if (at) t.history.push([now, at.distance]);

    const reason = callReason(
      {
        distance: at?.distance ?? Infinity,
        lastCheckedDistance: t.lastCheckedDistance,
        lastCheckAt: t.lastCheckAt,
        now,
        falling,
        mark: t.pending ? (this.mids[t.pending.coin] ?? 0) : 0,
        pendingLiqBefore: t.pending?.liq ?? null,
        justRescued: t.justRescued,
      },
      this.band,
    );
    if (!reason || now - t.lastCheckAt < this.timing.minCheckMs) return null;

    const started = Date.now();
    const status = await this.check(t.guard.guardId).catch(() => 'error');
    t.lastCheckAt = now;
    t.lastCheckedDistance = at?.distance ?? null;
    t.checks = t.checks.filter((c) => now - c < 86_400_000).concat(now);
    if (status === 'rescued') {
      t.inFlightSince ??= now;
      // The liquidation price before the rescue was public: watch the mark near it to settle the rescue.
      if (at) t.pending = { coin: at.coin, liq: at.liq, until: now + this.timing.settlementWatchMs };
      t.stateAt = -Infinity;
    } else if (status !== 'pending') t.inFlightSince = null;
    // The checker records a credit on a later check, so keep calling while a rescue is in flight.
    t.justRescued = t.inFlightSince !== null;
    const late = t.inFlightSince !== null && now - t.inFlightSince > this.timing.creditWatchdogMs;
    const call: Call = { guardId: t.guard.guardId, reason, status, ms: Date.now() - started };
    if (late) call.alert = `rescue in flight for ${Math.round((now - t.inFlightSince!) / 1000)} s`;
    return call;
  }
}
