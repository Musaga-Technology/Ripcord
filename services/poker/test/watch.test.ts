import { describe, expect, it } from 'vitest';
import type { HlPosition, Hyperliquid } from '../src/hl';
import { Watcher } from '../src/watch';

/** A fake Hyperliquid: one long BTC position whose liquidation price and mid the test moves. */
function fakeHl(liq: number, mid: number) {
  const m = { liq, mid, stateReads: 0, midReads: 0 };
  const hl: Hyperliquid = {
    state: async (): Promise<HlPosition[]> => {
      m.stateReads++;
      return [{ coin: 'BTC', szi: 1, liquidationPx: m.liq }];
    },
    mids: async () => {
      m.midReads++;
      return { BTC: m.mid };
    },
  };
  return { m, hl };
}

function setup(liq: number, mid: number, answer = 'guarding') {
  const { m, hl } = fakeHl(liq, mid);
  const calls: string[] = [];
  const check = async (id: string) => {
    calls.push(id);
    return answer;
  };
  const w = new Watcher(hl, check);
  w.add({ guardId: 'g-vf6per4bfx', hlAddress: '0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3' });
  return { m, w, calls, setAnswer: (a: string) => (answer = a) };
}

describe('the poker watch loop', () => {
  it('checks a new guard once, then stays quiet far from liquidation until the hourly heartbeat', async () => {
    const { w, calls } = setup(40_000, 80_000); // 50 % away
    expect((await w.tick(0)).map((c) => c.reason)).toEqual(['heartbeat']);
    expect(await w.tick(60_000)).toEqual([]);
    expect(await w.tick(3_599_000)).toEqual([]);
    expect((await w.tick(3_600_000)).map((c) => c.reason)).toEqual(['heartbeat']);
    expect(calls).toHaveLength(2);
  });

  it('wakes the checker when the distance enters the 30 % band', async () => {
    const { w } = setup(60_000, 80_000); // 25 %
    expect((await w.tick(0)).map((c) => c.reason)).toEqual(['band-drop']);
  });

  it('reads liquidation prices every 60 s outside the band and every 10 s inside', async () => {
    const far = setup(40_000, 80_000);
    for (let t = 0; t < 120_000; t += 1_000) await far.w.tick(t);
    expect(far.m.stateReads).toBe(2);
    const near = setup(60_000, 80_000);
    for (let t = 0; t < 120_000; t += 1_000) await near.w.tick(t);
    expect(near.m.stateReads).toBe(12);
    expect(near.m.midReads).toBe(40); // every 3 s
  });

  it('calls at most every 3 s, then on each further 0.5 pp drop', async () => {
    const { m, w, calls } = setup(60_000, 80_000);
    await w.tick(0); // 25 %: band-drop
    m.mid = 79_000; // 24.05 %: a 0.95 pp drop, but only 1 s later
    await w.tick(1_000);
    expect(calls).toHaveLength(1);
    await w.tick(3_000);
    expect(calls).toHaveLength(2);
  });

  it('after a rescue: records it, then watches the old liquidation price to settle it', async () => {
    const s = setup(76_000, 80_000, 'rescued'); // 5 %
    expect((await s.w.tick(0)).map((c) => c.status)).toEqual(['rescued']);
    s.setAnswer('guarding');
    s.m.liq = 70_000; // the rescue moved the liquidation price
    expect((await s.w.tick(3_000)).map((c) => c.reason)).toEqual(['after-rescue']);
    s.m.mid = 76_200; // within 0.5 % of the $76,000 from before the rescue
    expect((await s.w.tick(6_000)).map((c) => c.reason)).toEqual(['settlement']);
  });

  it('reports health without an address, and survives a failing checker', async () => {
    const { m, hl } = fakeHl(60_000, 80_000);
    const w = new Watcher(hl, async () => {
      throw new Error('down');
    });
    w.add({ guardId: 'g-vf6per4bfx', hlAddress: '0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3' });
    expect((await w.tick(5_000)).map((c) => c.status)).toEqual(['error']);
    expect(w.health('g-vf6per4bfx', 6_000)).toEqual({ last_check_at: 5_000, checks_24h: 1 });
    expect(JSON.stringify(w.health('g-vf6per4bfx', 6_000))).not.toContain('0x');
    expect(m.stateReads).toBe(1);
  });
});
