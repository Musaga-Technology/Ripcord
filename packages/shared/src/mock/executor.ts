// A mock of the guard wallet's custody API (OutLayer `/confidential/withdraw` and `/requests/{id}`) with fault
// injection, plus the rescue client's retry rules from ARCHITECTURE §8. Demo mode and CI use it; the checker's
// Rust executor follows the same rules. Time is simulated, so a 120 s credit runs in microseconds.

export type Fault = 'ok' | '502' | '503' | 'busy' | 'refund' | 'slow';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export function simClock(start = 0): Clock {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

type RequestState = 'processing' | 'success' | 'refunded';

interface MockRequest {
  id: string;
  key: string;
  amount: number;
  to: string;
  state: RequestState;
  settlesAt: number;
  outcome: 'success' | 'refunded';
}

export type WithdrawResult =
  | { ok: true; request_id: string; status: 'processing' }
  | { ok: false; code: 502; error: 'keystore_error' }
  | { ok: false; code: 503; error: 'confidential_unavailable' }
  | { ok: false; code: 409; error: 'wallet_busy'; in_flight_request_id: string };

export interface Credit {
  to: string;
  amount: number;
  at: number;
  request_id: string;
}

/** Custody wallet + Hyperliquid credit ledger. Faults are consumed one per withdraw call, in order. */
export class MockCustody {
  readonly credits: Credit[] = [];
  private readonly byKey = new Map<string, MockRequest>();
  private readonly byId = new Map<string, MockRequest>();
  private nextId = 1;
  private inFlight: MockRequest | null = null;
  calls = 0;

  constructor(
    private readonly clock: Clock,
    private readonly faults: Fault[] = [],
    private readonly landMs = 30_000,
    private readonly slowMs = 120_000,
  ) {}

  withdraw(req: { key: string; amount: number; to: string }): WithdrawResult {
    this.calls++;
    this.tick();
    // Idempotency first: the same key always returns the same request and never moves money twice.
    const existing = this.byKey.get(req.key);
    if (existing) return { ok: true, request_id: existing.id, status: 'processing' };
    const fault = this.faults.shift() ?? 'ok';
    if (fault === '502') return { ok: false, code: 502, error: 'keystore_error' };
    if (fault === '503') return { ok: false, code: 503, error: 'confidential_unavailable' };
    if (fault === 'busy' && this.inFlight) {
      return { ok: false, code: 409, error: 'wallet_busy', in_flight_request_id: this.inFlight.id };
    }
    const r: MockRequest = {
      id: `req-${this.nextId++}`,
      key: req.key,
      amount: req.amount,
      to: req.to,
      state: 'processing',
      settlesAt: this.clock.now() + (fault === 'slow' ? this.slowMs : this.landMs),
      outcome: fault === 'refund' ? 'refunded' : 'success',
    };
    this.byKey.set(req.key, r);
    this.byId.set(r.id, r);
    this.inFlight = r;
    return { ok: true, request_id: r.id, status: 'processing' };
  }

  /** Puts a request in flight without a key from this client (another poker, or an earlier check). */
  startForeign(amount: number, to: string, key: string): string {
    const res = this.withdraw({ key, amount, to });
    if (!res.ok) throw new Error('could not start a foreign request');
    return res.request_id;
  }

  request(id: string): { state: RequestState; amount_out?: number } {
    this.tick();
    const r = this.byId.get(id);
    if (!r) throw new Error(`unknown request ${id}`);
    return r.state === 'success' ? { state: r.state, amount_out: r.amount } : { state: r.state };
  }

  private tick(): void {
    for (const r of this.byId.values()) {
      if (r.state !== 'processing' || this.clock.now() < r.settlesAt) continue;
      r.state = r.outcome;
      if (r.state === 'success') this.credits.push({ to: r.to, amount: r.amount, at: r.settlesAt, request_id: r.id });
      if (this.inFlight === r) this.inFlight = null;
    }
  }
}

export type RescueResult =
  | { state: 'credited'; request_id: string; amount: number; latency_ms: number; attempts: number }
  | { state: 'degraded'; reason: 'confidential_unavailable'; attempts: number }
  | { state: 'failed'; reason: string; attempts: number };

export interface RescueOptions {
  guardId: string;
  epoch: number;
  amount: number;
  to: string;
  pollMs?: number;
  watchdogMs?: number;
  max502?: number;
  maxRefires?: number;
}

/**
 * One rescue, following ARCHITECTURE §8: 502 → retry with the same idempotency key; 503 → degraded (retry on the
 * next check, never a public fallback); wallet_busy → poll the in-flight request; processing → poll, never
 * resubmit; refunded → fire a fresh rescue at once with a new key; credit watchdog at 90 s reads the status.
 */
export async function rescue(custody: MockCustody, clock: Clock, o: RescueOptions): Promise<RescueResult> {
  const pollMs = o.pollMs ?? 3_000;
  const watchdogMs = o.watchdogMs ?? 90_000;
  const started = clock.now();
  let attempts = 0;
  for (let refire = 0; refire <= (o.maxRefires ?? 2); refire++) {
    const key = refire === 0 ? `${o.guardId}-${o.epoch}` : `${o.guardId}-${o.epoch}-r${refire}`;
    let requestId: string | null = null;
    for (let tries = 0; requestId === null; tries++) {
      attempts++;
      const res = custody.withdraw({ key, amount: o.amount, to: o.to });
      if (res.ok) requestId = res.request_id;
      else if (res.code === 502) {
        if (tries >= (o.max502 ?? 3)) return { state: 'failed', reason: 'keystore_error', attempts };
      } else if (res.code === 503) {
        return { state: 'degraded', reason: 'confidential_unavailable', attempts };
      } else {
        // Someone else's rescue is in flight: wait for it to finish, then try our own key again.
        await waitTerminal(custody, clock, res.in_flight_request_id, pollMs, 600_000);
      }
    }
    const sentAt = clock.now();
    const state = await waitTerminal(custody, clock, requestId, pollMs, watchdogMs, sentAt);
    if (state === 'success') {
      return {
        state: 'credited',
        request_id: requestId,
        amount: o.amount,
        latency_ms: clock.now() - started,
        attempts,
      };
    }
    // refunded: fire a fresh rescue at once under a new key.
  }
  return { state: 'failed', reason: 'refunded repeatedly', attempts };
}

async function waitTerminal(
  custody: MockCustody,
  clock: Clock,
  id: string,
  pollMs: number,
  watchdogMs: number,
  since = clock.now(),
): Promise<'success' | 'refunded'> {
  for (;;) {
    const r = custody.request(id);
    if (r.state !== 'processing') return r.state;
    // Past the watchdog we keep reading the status (never resubmitting) but alert; the mock only advances time.
    await clock.sleep(clock.now() - since > watchdogMs ? pollMs * 2 : pollMs);
  }
}
