// Where a reserve can be sent from: a USDC reserve can come straight from the trader's Hyperliquid account.
import { describe, expect, it } from 'vitest';
import { ASSETS, FROM_HYPERLIQUID, sourcesFor, USDC_NEAR } from '../lib/assets';

describe('reserve sources', () => {
  it('offers Hyperliquid first for a USDC reserve, then the chain it was chosen on', () => {
    const usdc = ASSETS.find((a) => a.reserve === USDC_NEAR)!;
    expect(sourcesFor(usdc).map((s) => s.chain)).toEqual(['Hyperliquid', usdc.chain]);
    expect(FROM_HYPERLIQUID.reserve).toBe(USDC_NEAR);
  });

  it('sends from Hyperliquid with $1 on top, and says the send is public', () => {
    expect(FROM_HYPERLIQUID.source).toBe('1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054');
    expect(FROM_HYPERLIQUID.extra).toBe(1);
    expect(FROM_HYPERLIQUID.note).toMatch(/shows on Hyperliquid/);
  });

  it('funds every other reserve from its own chain only', () => {
    for (const a of ASSETS.filter((x) => x.reserve !== USDC_NEAR)) expect(sourcesFor(a)).toEqual([a]);
  });
});
