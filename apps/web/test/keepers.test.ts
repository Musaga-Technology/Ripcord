import { describe, expect, it } from 'vitest';
import { KEEPERS, keeperFor } from '../lib/keepers';

describe('the keepers in the simulation', () => {
  it('credit the same keeper when the same crash is replayed', () => {
    expect(keeperFor(7, 312)).toBe(keeperFor(7, 312));
  });

  it('pick a real keeper, and spread rescues across them', () => {
    const wins = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const k = keeperFor(seed, 300 + seed * 3);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(KEEPERS.length);
      wins.add(k);
    }
    expect(wins.size).toBeGreaterThan(KEEPERS.length / 2);
  });
});
