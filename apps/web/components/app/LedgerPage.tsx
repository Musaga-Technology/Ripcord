'use client';

// Public ledger: the registry's totals, read from NEAR in the browser, and the rescues their owners published.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { readReceipts, readStats } from '../../lib/backend';
import { hourText, ledgerRows, quantile, type LedgerRow, type Stats } from '../../lib/ledger';
import { accountUrl, NETWORK_NAME, PUBLISHED_GUARDS, REGISTRY } from '../../lib/near';
import { SessionProvider } from '../../lib/session';
import { usd } from '../format';
import { AppShell, ghostBtn } from './AppShell';

type Read = { at: 'loading' } | { at: 'error' } | { at: 'ready'; stats: Stats; rows: LedgerRow[]; readAt: number };

const HL_TX = (hash: string) => `https://app.hyperliquid.xyz/explorer/tx/${hash}`;

function Tile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[16px] border border-line bg-panel px-5 py-4">
      <span className="text-[13px] text-muted">{label}</span>
      {value === null ? (
        <span className="my-[5px] h-[30px] w-20 rounded-full bg-line" />
      ) : (
        <span className="text-[32px] font-semibold leading-[40px] tracking-[-0.03em] tabular-nums">{value}</span>
      )}
    </div>
  );
}

function Ledger() {
  const [read, setRead] = useState<Read>({ at: 'loading' });

  const load = useCallback(async () => {
    try {
      const [stats, receipts] = await Promise.all([
        readStats(),
        Promise.all(PUBLISHED_GUARDS.map(async (id) => [id, (await readReceipts(id)) ?? []] as const)),
      ]);
      if (!stats) throw new Error('no answer');
      setRead({ at: 'ready', stats, rows: ledgerRows(receipts.map(([id, r]) => [id, r])), readAt: Date.now() });
    } catch {
      setRead({ at: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const s = read.at === 'ready' ? read.stats : null;
  const rows = read.at === 'ready' ? read.rows : [];
  const median = quantile(
    rows.map((r) => r.latencyS),
    0.5,
  );
  const slowest = quantile(
    rows.map((r) => r.latencyS),
    0.95,
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">Ledger.</h1>
        <p className="max-w-[60ch] text-[17px] text-text-2">
          Every rescue Ripcord makes is recorded on NEAR. Anyone can read it, and no one can tell whose it was.
        </p>
      </header>

      <section aria-label="Totals" className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Rescues" value={s && String(s.rescues)} />
          <Tile label="Saves" value={s && String(s.saves)} />
          <Tile label="Margin added" value={s && usd(s.margin_added_usd)} />
          <Tile label="Guards" value={s && String(s.guards)} />
        </div>
        {read.at === 'error' ? (
          <p role="alert" className="flex flex-wrap items-center gap-3 text-[15px] text-red">
            {NETWORK_NAME} didn&apos;t answer. The ledger is read from the chain, so try again in a moment.
            <button type="button" className={`${ghostBtn} px-4`} onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="text-[13px] text-muted">
            Counted by the registry contract{' '}
            <a
              href={accountUrl(REGISTRY)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline decoration-line-3 underline-offset-4 hover:text-text"
            >
              {REGISTRY}
            </a>{' '}
            on {NETWORK_NAME}
            {read.at === 'ready' &&
              `, read at ${new Date(read.readAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            .
          </p>
        )}
      </section>

      <section aria-label="Rescues" className="overflow-hidden rounded-[20px] border border-line bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-semibold">Published rescues</h2>
          {median !== null && slowest !== null && (
            <span className="text-[13px] text-muted tabular-nums">
              Median {median} s to land · slowest 5% {slowest} s
            </span>
          )}
        </div>
        {read.at === 'loading' ? (
          <div className="flex flex-col gap-3 px-5 py-5" aria-hidden="true">
            <span className="h-[18px] w-2/3 rounded-full bg-line" />
            <span className="h-[18px] w-1/2 rounded-full bg-line" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-5 py-5">
            <p className="text-text-2">
              No published rescues yet. A rescue appears here when its owner publishes proof.
            </p>
            <Link
              href="/verify?example"
              className="inline-flex min-h-11 items-center text-[15px] underline decoration-line-3 underline-offset-4 hover:text-text"
            >
              Verify an example guard
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[15px] tabular-nums">
              <thead className="text-[13px] text-muted">
                <tr>
                  <th className="py-3 pl-5 pr-2 font-medium">When</th>
                  <th className="px-2 py-3 font-medium">Margin added</th>
                  <th className="px-2 py-3 font-medium">Landed in</th>
                  <th className="px-2 py-3 font-medium">Outcome</th>
                  <th className="py-3 pl-2 pr-5 font-medium">Proof</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.guardId}-${r.hour}-${i}`} className="border-t border-line">
                    <td className="py-3.5 pl-5 pr-2">{hourText(r.hour)}</td>
                    <td className="px-2 py-3.5">about {usd(r.creditUsd)}</td>
                    <td className="px-2 py-3.5">{r.latencyS} s</td>
                    <td
                      className={`px-2 py-3.5 font-medium ${r.outcome === 'Saved' ? 'text-green' : r.outcome === 'Settling' ? 'text-amber' : r.outcome === 'Liquidated' ? 'text-red' : ''}`}
                    >
                      {r.outcome}
                    </td>
                    <td className="py-3.5 pl-2 pr-5">
                      {r.hlTx ? (
                        <a
                          href={HL_TX(r.hlTx)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-line-3 underline-offset-4 hover:text-text"
                        >
                          On Hyperliquid
                        </a>
                      ) : (
                        <span className="text-muted">Not published</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
          Times are to the hour and amounts rounded, so a rescue can&apos;t be matched to an account. Owners can publish
          full proof.
        </p>
      </section>
    </div>
  );
}

export function LedgerView() {
  return (
    <SessionProvider>
      <AppShell>
        <Ledger />
      </AppShell>
    </SessionProvider>
  );
}
