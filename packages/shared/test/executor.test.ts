// T-SEC-09 (docs/SPEC.md §6): fault injection on the rescue path. Whatever the custody API does, a rescue is
// paid at most once, a 503 never falls back to a public route, and every run ends in a known state.
import { describe, expect, it } from 'vitest';
import { MockCustody, rescue, simClock, type Fault } from '../src/mock/executor';

const HL = '0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3';
const base = { guardId: 'g-vf6per4bfx', epoch: 3, amount: 1486.18, to: HL };

async function run(faults: Fault[]) {
  const clock = simClock();
  const custody = new MockCustody(clock, faults);
  const result = await rescue(custody, clock, base);
  return { result, custody };
}

describe('rescue under fault injection', () => {
  it('lands once on the happy path, in about 30 s', async () => {
    const { result, custody } = await run(['ok']);
    expect(result.state).toBe('credited');
    expect(custody.credits).toHaveLength(1);
    expect(custody.credits[0]!.amount).toBe(1486.18);
    expect(result.state === 'credited' && result.latency_ms).toBeLessThanOrEqual(33_000);
  });

  it('retries a 502 with the same key and pays once', async () => {
    const { result, custody } = await run(['502', '502', 'ok']);
    expect(result.state).toBe('credited');
    expect(custody.credits).toHaveLength(1);
    expect(result.attempts).toBe(3);
  });

  it('gives up after repeated 502s without paying', async () => {
    const { result, custody } = await run(['502', '502', '502', '502', '502']);
    expect(result.state).toBe('failed');
    expect(custody.credits).toHaveLength(0);
  });

  it('marks a 503 degraded and never falls back to a public route', async () => {
    const { result, custody } = await run(['503']);
    expect(result).toMatchObject({ state: 'degraded', reason: 'confidential_unavailable' });
    expect(custody.credits).toHaveLength(0);
    expect(custody.calls).toBe(1);
  });

  it('re-fires at once after a refund, under a new key, and pays once', async () => {
    const { result, custody } = await run(['refund', 'ok']);
    expect(result.state).toBe('credited');
    expect(custody.credits).toHaveLength(1);
  });

  it('waits out a slow credit (120 s) without resubmitting', async () => {
    const { result, custody } = await run(['slow']);
    expect(result.state).toBe('credited');
    expect(custody.credits).toHaveLength(1);
    expect(custody.calls).toBe(1);
    expect(result.state === 'credited' && result.latency_ms).toBeGreaterThanOrEqual(120_000);
  });

  it('waits for a request already in flight (wallet busy), then pays its own once', async () => {
    const clock = simClock();
    const custody = new MockCustody(clock, ['ok', 'busy', 'ok']);
    custody.startForeign(500, HL, 'g-vf6per4bfx-2');
    const result = await rescue(custody, clock, base);
    expect(result.state).toBe('credited');
    expect(custody.credits.filter((c) => c.amount === 1486.18)).toHaveLength(1);
  });

  it('two pokers firing the same epoch pay once (idempotency key)', async () => {
    const clock = simClock();
    const custody = new MockCustody(clock, ['ok', 'ok']);
    const [a, b] = await Promise.all([rescue(custody, clock, base), rescue(custody, clock, base)]);
    expect(a.state).toBe('credited');
    expect(b.state).toBe('credited');
    expect(custody.credits).toHaveLength(1);
  });

  it('never pays twice across a random mix of faults', async () => {
    const all: Fault[] = ['ok', '502', '503', 'busy', 'refund', 'slow'];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 300; n++) {
      const faults = Array.from({ length: 6 }, () => all[Math.floor(rand() * all.length)]!);
      const { result, custody } = await run(faults);
      expect(custody.credits.length).toBeLessThanOrEqual(1);
      expect(['credited', 'degraded', 'failed']).toContain(result.state);
      if (result.state === 'credited') expect(custody.credits).toHaveLength(1);
      else expect(custody.credits).toHaveLength(0);
    }
  });
});
