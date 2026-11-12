import { describe, expect, it } from 'vitest';
import { parseAccount } from '@ripcord/shared';
import { findAddress, shortAddress } from '../src/read';
import { assess, levelOf, replayOdds, riskMarkdown } from '../src/risk';
import { ADDRESS, STATE } from './fixtures';

const NOW = new Date('2026-11-12T13:50:00Z');

describe('the risk report', () => {
  const risk = assess(parseAccount(STATE), NOW);

  it('puts the position nearest to liquidation first and one without a liquidation price last', () => {
    expect(risk.positions.map((p) => p.position)).toEqual(['ETH long', 'SOL long', 'BTC short']);
    expect(risk.positions[0]!.distance).toBeCloseTo(17.28, 1);
    expect(risk.positions[0]!.level).toBe('worth watching');
    expect(risk.positions[2]!.distance).toBeNull();
  });

  it("quotes the replay closest to the nearest position's coin and leverage", () => {
    expect(risk.replay).toMatchObject({ coin: 'ETH', leverage: 10 });
  });

  it('names levels by distance', () => {
    expect([2, 7, 15, 30, null].map(levelOf)).toEqual([
      'one wick away',
      'close',
      'worth watching',
      'comfortable',
      null,
    ]);
  });

  it('reads as Markdown with a row per position, the nearest called out, and its sources', () => {
    const md = riskMarkdown(risk, { account: shortAddress(ADDRESS), appUrl: 'https://app.test' });
    expect(md).toContain('| ETH long | cross | 10× | $29,906.32 | 2,411.8 | 1,995.1 | 17.3% (worth watching) |');
    expect(md).toContain('**Nearest: ETH long, 17.3% from liquidation.**');
    expect(md).toContain('Set one up at https://app.test/guards.');
    expect(md).toContain('crates/replay');
  });

  it('never repeats the full address or suggests a guard setting', () => {
    const md = riskMarkdown(risk, { account: shortAddress(ADDRESS), appUrl: null });
    expect(md).not.toContain(ADDRESS);
    expect(md).not.toMatch(/rescue range|tops up to|defence line/i);
  });

  it('says so when an account has nothing open', () => {
    const empty = assess({ value: 0, holdings: [] }, NOW);
    expect(empty.replay).toBeNull();
    expect(riskMarkdown(empty, { account: '0x0000…0000', appUrl: null })).toContain('No open positions');
  });
});

describe('the replay figures', () => {
  it('match the replay table the set-up screen reads', () => {
    expect(replayOdds('BTC', 10)).toMatchObject({
      unguarded: 14.38,
      guarded1x: 1.92,
      guarded2x: 0.09,
      upfront1x: 1.83,
    });
  });

  it('fall back to ETH and the nearest leverage the replays ran', () => {
    expect(replayOdds('DOGE', 7)).toMatchObject({ coin: 'ETH', leverage: 10 });
    expect(replayOdds('sol', 4)).toMatchObject({ coin: 'SOL', leverage: 5 });
  });
});

describe('addresses', () => {
  it('are found in free text and shortened for display', () => {
    expect(findAddress(`check ${ADDRESS.toUpperCase().replace('0X', '0x')} please`)).toBe(
      ADDRESS.toUpperCase().replace('0X', '0x'),
    );
    expect(findAddress('0x1234')).toBeNull();
    expect(findAddress(`${ADDRESS}ff`)).toBeNull();
    expect(shortAddress(ADDRESS)).toBe('0x15a6…9fe3');
  });
});
