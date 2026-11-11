// The ledger shows what the registry keeps: the hour, a rounded amount, the time to land and the outcome.
import { describe, expect, it } from 'vitest';
import { hourText, ledgerRows, quantile } from '../lib/ledger';

const r = (at_hour: number, latency_s: number, outcome: string, hl_tx?: string) => ({
  public: { at_hour, credit_usd: 50, latency_s, outcome },
  proof: hl_tx ? { at: at_hour + 1234, hl_credit_usd: 48.71, hl_tx } : null,
});

describe('the ledger', () => {
  it('lists every published rescue, newest first, with its proof only when published', () => {
    const rows = ledgerRows([
      ['g-a', [r(1_794_000_000, 21, 'saved', '0xabc'), r(1_794_007_200, 19, 'early')]],
      ['g-b', [r(1_794_003_600, 34, 'pending')]],
    ]);
    expect(rows.map((x) => [x.guardId, x.outcome, x.hlTx])).toEqual([
      ['g-a', 'Close call', null],
      ['g-b', 'Settling', null],
      ['g-a', 'Saved', '0xabc'],
    ]);
  });

  it('gives the median and the slowest 5 % by nearest rank', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([30], 0.95)).toBe(30);
    expect(quantile([19, 34, 21], 0.5)).toBe(21);
    expect(
      quantile(
        Array.from({ length: 20 }, (_, i) => i + 1),
        0.95,
      ),
    ).toBe(19);
  });

  it('writes the hour, never the minute', () => {
    expect(hourText(Date.UTC(2026, 10, 11, 14, 0, 0) / 1000)).toBe('Nov 11, 14:00 UTC');
  });
});
