// The landing hero plays the real Oct 10, 2025 ETH crash through the guard's real rules: the guarded position lives
// through the wick to 3,400; the same position with no guard is liquidated.
import { describe, expect, it } from 'vitest';
import { clockOf, END_T, HeroRun, POS } from '../lib/heroRun';

describe('the hero run', () => {
  const run = new HeroRun();
  while (!run.over) run.step();

  it('opens at the real 21:00 UTC price', () => {
    expect(POS.entry).toBeCloseTo(3865, -1);
  });

  it('is liquidated with no guard, and lives with one', () => {
    expect(run.unguardedAt).not.toBeNull();
    expect(clockOf(run.unguardedAt!)).toBe('21:16:37');
    expect(run.guard.phase).not.toBe('liquidated');
  });

  it('rescues before the wick, and the first rescue counts as a save', () => {
    expect(run.landings.length).toBeGreaterThanOrEqual(1);
    expect(run.landings[0]!.t).toBeLessThan(run.unguardedAt!);
    expect(run.guard.rescues[0]!.outcome).toBe('saved');
    expect(run.savedAt).not.toBeNull();
  });

  it('fits the whole run in one fixed price range', () => {
    const [lo, hi] = HeroRun.range();
    expect(lo).toBeLessThan(3400);
    expect(hi).toBeGreaterThan(POS.entry);
    expect(run.t).toBe(END_T);
  });
});
