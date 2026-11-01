import { describe, expect, it } from 'vitest';
import { balance, runwayDays } from '../src/monitor';

describe('the payment key monitor', () => {
  it('estimates runway from the spend rate', () => {
    expect(runwayDays([{ at: 0, available: 10 }])).toBe(Infinity);
    expect(
      runwayDays([
        { at: 0, available: 10 },
        { at: 86_400_000, available: 9 },
      ]),
    ).toBe(9);
    expect(
      runwayDays([
        { at: 0, available: 10 },
        { at: 86_400_000, available: 10 },
      ]),
    ).toBe(Infinity);
  });

  it('reads the public balance and never sends the secret', async () => {
    let asked = '';
    const read = balance('https://api.example', 'ripcord-ops.near:1:deadbeef', async (url) => {
      asked = String(url);
      return new Response(JSON.stringify({ available: '4250000' }));
    });
    expect(await read()).toBe(4.25);
    expect(asked).toBe('https://api.example/public/payment-keys/ripcord-ops.near/1/balance');
    expect(asked).not.toContain('deadbeef');
  });
});
