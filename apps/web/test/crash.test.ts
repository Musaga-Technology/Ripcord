// "Try a crash" runs the guard's real rules: a fair reserve saves the position, a tiny one doesn't, and shorts mirror longs.
import { describe, expect, it } from 'vitest';
import { CrashRun, marginFor } from '../lib/crash';
import { liqPrice, type GuardSpec, type PositionSpec } from '../lib/sim';

const guard = (reserveX: number): GuardSpec => ({
  lineRange: [5, 8],
  targetRange: [9, 13],
  speedAware: true,
  reserveX,
  landS: 38,
  cooldownS: 60,
});

function position(side: 1 | -1, entry: number, liq: number): PositionSpec {
  const notional = 30_000;
  const mm = 0.02;
  return { side, entry, notional, leverage: 10, mm, margin: marginFor(side, entry, notional, mm, liq) };
}

function play(pos: PositionSpec, reserveX: number, seed: number): CrashRun {
  const run = new CrashRun(pos, guard(reserveX), seed);
  run.crashing = true;
  for (let i = 0; i < 2000 && !run.over; i++) run.step();
  return run;
}

describe('a crash through the real rules', () => {
  it('puts the liquidation price where Hyperliquid shows it', () => {
    const long = position(1, 2411.8, 1995.1);
    const short = position(-1, 83_000, 98_940);
    expect(liqPrice(long, long.margin!)).toBeCloseTo(1995.1, 6);
    expect(liqPrice(short, short.margin!)).toBeCloseTo(98_940, 6);
  });

  it.each([
    ['a long', position(1, 2411.8, 1995.1)],
    ['a short', position(-1, 83_000, 98_940)],
  ])('saves %s with a fair reserve, on every seed', (_, pos) => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = play(pos, 1.4, seed);
      expect(r.guard.phase, `seed ${seed}`).not.toBe('liquidated');
      expect(r.savedAt, `seed ${seed}`).not.toBeNull();
      expect(r.guard.rescues.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('a reserve too small for the fall ends in a liquidation', () => {
    const pos = position(1, 2411.8, 1995.1);
    const lost = Array.from({ length: 20 }, (_, i) => play(pos, 0.01, i + 1)).filter(
      (r) => r.guard.phase === 'liquidated',
    );
    expect(lost.length).toBe(20);
  });
});
