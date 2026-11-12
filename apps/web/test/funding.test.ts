import { describe, expect, it } from 'vitest';
import { ASSETS, FROM_ANY_WALLET, FROM_HYPERLIQUID, sourcesFor, USDC_NEAR } from '../lib/assets';
import { ARBITRUM_USDC } from '../lib/aurora';

const usdc = ASSETS.find((a) => a.reserve === USDC_NEAR)!;

describe('where a reserve is paid from', () => {
  it('offers USDC from Hyperliquid first, then from any wallet through Aurora once its key is set', () => {
    expect(sourcesFor(usdc, true).map((s) => s.label ?? s.chain)).toEqual(['Hyperliquid', 'any wallet']);
  });

  it('keeps the hand-sent Arbitrum route while the widget is off', () => {
    expect(sourcesFor(usdc, false)).toEqual([FROM_HYPERLIQUID, usdc]);
  });

  it("pays into the guard's Arbitrum USDC deposit address, the same reserve as any other USDC", () => {
    expect(FROM_ANY_WALLET).toMatchObject({
      source: ARBITRUM_USDC,
      reserve: USDC_NEAR,
      widget: true,
      chain: 'Arbitrum',
    });
    expect(usdc.source).toBe(ARBITRUM_USDC);
  });

  it('leaves the other reserve assets on their own chains', () => {
    for (const a of ASSETS.filter((x) => x.reserve !== USDC_NEAR)) expect(sourcesFor(a, true)).toEqual([a]);
  });
});
