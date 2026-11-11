// Ledger figures. Rescues are shown as the registry keeps them: to the hour, with rounded amounts.

export interface Stats {
  guards: number;
  rescues: number;
  saves: number;
  margin_added_usd: number;
}

export interface LedgerReceipt {
  public: { at_hour: number; credit_usd: number; latency_s: number; outcome: string };
  proof?: { at: number; hl_credit_usd: number; hl_tx: string } | null;
}

export interface LedgerRow {
  guardId: string;
  /** Seconds since the epoch, at the start of the hour. */
  hour: number;
  creditUsd: number;
  latencyS: number;
  outcome: 'Saved' | 'Settling' | 'Close call' | 'Liquidated';
  hlTx: string | null;
}

const OUTCOME: Record<string, LedgerRow['outcome']> = {
  pending: 'Settling',
  saved: 'Saved',
  early: 'Close call',
  failed: 'Liquidated',
};

/** Newest first. */
export function ledgerRows(byGuard: [string, LedgerReceipt[]][]): LedgerRow[] {
  return byGuard
    .flatMap(([guardId, receipts]) =>
      receipts.map((r) => ({
        guardId,
        hour: r.public.at_hour,
        creditUsd: r.public.credit_usd,
        latencyS: r.public.latency_s,
        outcome: OUTCOME[r.public.outcome] ?? 'Settling',
        hlTx: r.proof?.hl_tx ?? null,
      })),
    )
    .sort((a, b) => b.hour - a.hour);
}

/** The q-quantile of the times to land (nearest rank), or null with no rescue. */
export function quantile(latencies: number[], q: number): number | null {
  if (latencies.length === 0) return null;
  const s = [...latencies].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

/** "Nov 11, 14:00 UTC": the hour the registry keeps, never finer. */
export const hourText = (s: number) =>
  `${new Date(s * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${String(
    new Date(s * 1000).getUTCHours(),
  ).padStart(2, '0')}:00 UTC`;
