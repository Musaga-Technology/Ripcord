// The plain-words set-up: only the model's enclave can read the request, its answer is read strictly, and the reserve
// for "survive a 25% drop" is computed here, not by the model.
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { openWith, parseIntent, reserveToSurvive, sealTo } from '../lib/copilot';
import type { Holding } from '../lib/hl';

const sol: Holding = {
  coin: 'SOL',
  szi: 140,
  size: 140,
  side: 'Long',
  mark: 106.99,
  entry: 100,
  liquidation: 87.1,
  distance: 18.6,
  leverage: 5,
  margin: 'isolated',
  marginUsed: 2996,
  maxLeverage: 20,
  notional: 14_978.6,
};

describe('the plain-words set-up', () => {
  it('encrypts so that only the holder of the enclave key reads it', () => {
    const enclave = ed25519.utils.randomSecretKey();
    const sealed = sealTo(bytesToHex(ed25519.getPublicKey(enclave)), 'keep my SOL long alive through a 25% drop');
    expect(sealed).toMatch(/^[0-9a-f]+$/);
    expect(sealed).not.toContain(Buffer.from('SOL').toString('hex'));
    expect(openWith(enclave, sealed)).toBe('keep my SOL long alive through a 25% drop');
    expect(() => openWith(ed25519.utils.randomSecretKey(), sealed)).toThrow();
  });

  it('reads only known fields, in range, and ignores anything else the model says', () => {
    const i = parseIntent(
      'Sure! {"reserve_asset": "btc", "reserve_usd": null, "survive_drop_pct": 25, "preset": "Lean", "say": "Keep SOL alive through 25%", "hl_address": "0xattacker", "max_rescue_usd": 1e9}',
    );
    expect(i).toEqual({
      asset: 'BTC',
      reserveUsd: null,
      surviveDropPct: 25,
      preset: 'lean',
      say: 'Keep SOL alive through 25%',
    });
    expect(parseIntent('{"reserve_asset": "DOGE", "survive_drop_pct": 400, "preset": "yolo"}')).toMatchObject({
      asset: null,
      surviveDropPct: null,
      preset: null,
    });
    expect(parseIntent('no json here')).toBeNull();
  });

  it('computes the reserve that moves the liquidation price past the drop', () => {
    // A 25% drop from 106.99 is 80.24; moving liquidation from 87.10 to there takes 6.86 × 140 × (1 − 0.025).
    expect(reserveToSurvive(sol, 25)).toBeCloseTo((87.1 - 106.99 * 0.75) * 140 * 0.975, 2);
    expect(reserveToSurvive(sol, 10)).toBe(0); // already survives a 10% drop
    const short: Holding = {
      ...sol,
      side: 'Short',
      szi: -0.8,
      size: 0.8,
      mark: 83_000,
      liquidation: 98_940,
      maxLeverage: 40,
    };
    expect(reserveToSurvive(short, 25)).toBeCloseTo((83_000 * 1.25 - 98_940) * 0.8 * (1 + 1 / 80), 2);
    expect(reserveToSurvive({ ...sol, liquidation: null }, 25)).toBeNull();
  });
});
