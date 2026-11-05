import { describe, expect, it } from 'vitest';
import { canPush, liquidatedWithout, price, push, sealedLines, start, tick, type Hunt } from '../lib/hunt';
import { distance } from '../lib/sim';

/** The hardest honest attack the game allows: a sale every time the book has refilled. */
function hunt(seed: number): Hunt {
  const h = start(seed);
  for (let i = 0; i < 250 && !h.over; i++) {
    if (canPush(h)) push(h);
    tick(h);
  }
  return h;
}
const seeds = Array.from({ length: 100 }, (_, i) => i + 1);

describe('try to hunt it', () => {
  it('the guard holds against a sale every tick, on every seed', () => {
    for (const s of seeds) expect(hunt(s).over, `seed ${s}`).not.toBe('liquidated');
  });

  it('the same sales liquidate the same position with no reserve', () => {
    const lost = seeds.filter((s) => liquidatedWithout(hunt(s)) !== null).length;
    expect(lost).toBeGreaterThanOrEqual(95);
  });

  it('the book refills: one sale per tick', () => {
    const h = start(1);
    expect(push(h)).toBe(true);
    expect(push(h)).toBe(false);
    tick(h);
    expect(push(h)).toBe(true);
  });

  it('a rescue moves the public line away and redraws the sealed one', () => {
    const h = hunt(3);
    const landed = h.guard.rescues.filter((r) => r.landedAt !== null);
    expect(landed.length).toBeGreaterThan(0);
    expect(h.guard.liq).toBeLessThan(landed[0]!.liqBefore);
    expect(distance(h.guard.liq, price(h))).toBeGreaterThan(0);
    const lines = sealedLines(h);
    expect(lines.length).toBe(h.guard.rescues.length + 1);
    for (const l of lines) expect(l.pct >= 4.4 && l.pct <= 5.6).toBe(true);
  });

  it('a run replays exactly from its seed', () => {
    expect(hunt(9).pts).toEqual(hunt(9).pts);
  });
});
