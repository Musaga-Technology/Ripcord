'use client';

import type { DemoRow } from '@ripcord/shared/mock';
import { useState } from 'react';
import { price, pct } from './format';
import { GuardCard } from './GuardCard';

type View = 'yours' | 'hunter';

/** Positions with their guards, and the selected guard in two views: yours (the card) and a hunter's. */
export function Dashboard({ rows }: { rows: DemoRow[] }) {
  const firstGuarded = rows.findIndex((r) => r.guard !== null);
  const [selected, setSelected] = useState(firstGuarded < 0 ? 0 : firstGuarded);
  const [view, setView] = useState<View>('yours');
  const [peek, setPeek] = useState(false);
  const row = rows[selected]!;
  const g = row.guard;
  const guardedCount = rows.filter((r) => r.guard).length;

  return (
    <div className="flex flex-wrap items-start gap-6">
      <section
        aria-label="Positions"
        className="order-2 min-w-0 flex-[999_1_720px] overflow-hidden rounded-[20px] border border-line bg-panel md:order-1"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-semibold">Positions</h2>
          <span className="text-[13px] text-muted">
            {guardedCount} of {rows.length} guarded
          </span>
        </div>
        {/* Phone: compact rows (DESIGN §3, card first). */}
        <ul className="md:hidden">
          {rows.map((r, i) => (
            <li key={r.coin} className="border-t border-line first:border-t-0">
              <button
                type="button"
                onClick={() => setSelected(i)}
                aria-pressed={i === selected}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-5 py-3.5 text-left tabular-nums ${i === selected ? 'bg-line/40' : ''}`}
              >
                <span className="font-semibold">
                  {r.coin}{' '}
                  <span className="text-[13px] font-normal text-muted">
                    {r.side} {r.leverage}× {r.margin}
                  </span>
                </span>
                <span className="text-right">{r.distance === null ? '—' : pct(r.distance) + ' away'}</span>
                <span className="flex items-center gap-2 text-[13px] text-muted">
                  <span className="h-[2px] w-[10px] rounded bg-red" />
                  Liq {r.liquidation === null ? '—' : price(r.liquidation)}
                </span>
                <span
                  className={`flex items-center justify-end gap-1.5 text-[13px] font-medium ${r.guard ? '' : 'text-muted'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${r.guard ? 'bg-amber' : 'bg-muted'}`} />
                  {r.guard ? 'Guarded' : 'Not guarded'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-[15px] tabular-nums">
            <thead>
              <tr className="text-left text-[13px] text-muted">
                <th className="px-5 py-3 font-medium">Market</th>
                <th className="px-3 py-3 text-right font-medium">Size</th>
                <th className="px-3 py-3 text-right font-medium">Mark</th>
                <th className="px-3 py-3 text-right font-medium">Liquidation</th>
                <th className="min-w-[150px] px-3 py-3 font-medium">Distance</th>
                <th className="px-5 py-3 text-right font-medium">Guard</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.coin}
                  className={`cursor-pointer border-t border-line ${i === selected ? 'bg-line/40' : 'hover:bg-line/25'}`}
                  onClick={() => setSelected(i)}
                  aria-selected={i === selected}
                >
                  <td className="px-5 py-4">
                    <button type="button" className="flex flex-col text-left" onClick={() => setSelected(i)}>
                      <span className="font-semibold">{r.coin}-USD</span>
                      <span className="text-[13px] text-muted">
                        {r.side} · {r.leverage}× {r.margin}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-4 text-right">
                    {r.size.toLocaleString('en-US')} {r.coin}
                  </td>
                  <td className="px-3 py-4 text-right">{price(r.mark)}</td>
                  <td className="px-3 py-4 text-right">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-[2px] w-[10px] rounded bg-red" />
                      {r.liquidation === null ? '—' : price(r.liquidation)}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-2.5">
                      <span className="relative h-1 flex-1 overflow-hidden rounded bg-line">
                        <span
                          className={`absolute inset-y-0 left-0 rounded ${r.distance !== null && r.distance < 5 ? 'bg-red' : 'bg-muted'}`}
                          style={{ width: `${Math.min(100, ((r.distance ?? 40) / 40) * 100)}%` }}
                        />
                      </span>
                      <span className="min-w-[48px] text-right">{r.distance === null ? '—' : pct(r.distance)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {r.guard ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-line-3 px-3 py-1 text-[13px] font-medium">
                        <span className="h-[7px] w-[7px] rounded-full bg-amber" />
                        {r.margin === 'isolated' ? 'Guarded · isolated' : 'Guarded'}
                      </span>
                    ) : (
                      <span className="inline-block rounded-full px-3.5 py-1.5 text-[13px] font-semibold shadow-[inset_0_0_0_1px_var(--line-3)]">
                        Guard
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="order-1 flex min-w-0 flex-[1_1_380px] flex-col gap-4 md:order-2" aria-label="Selected position">
        <div
          role="group"
          aria-label="View"
          className="flex w-fit gap-1 rounded-full border border-line bg-ground p-1 text-[13px]"
        >
          {(['yours', 'hunter'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-3.5 py-1.5 font-medium ${view === v ? 'bg-text text-ground' : 'text-muted hover:text-text'}`}
            >
              {v === 'yours' ? 'Your view' : "Hunter's view"}
            </button>
          ))}
        </div>

        {view === 'yours' && g ? (
          <>
            <GuardCard
              label={g.label}
              distance={row.distance === null ? '—' : pct(row.distance)}
              sub="from liquidation · rescue in under a minute"
              fingerprint={g.fingerprint}
              commitment={g.commitment}
              state="guarded"
              status="Guarded"
              reserve={peek ? g.sealed.reserve : '••••••'}
            />
            <span className="-mt-1 flex items-center gap-2 text-[13px] text-text-2">
              <span className="h-[7px] w-[7px] rounded-full bg-amber" />
              Guarded · checked 41 s ago
            </span>
            <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted">Sealed settings</span>
                <button
                  type="button"
                  className="rounded-full border border-line-3 px-3 py-1 text-[13px] font-medium select-none"
                  onPointerDown={() => setPeek(true)}
                  onPointerUp={() => setPeek(false)}
                  onPointerLeave={() => setPeek(false)}
                  onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setPeek(true)}
                  onKeyUp={() => setPeek(false)}
                >
                  Hold to peek
                </button>
              </div>
              <Fact label="Rescue range" value={peek ? `${g.sealed.range} from liquidation` : '••••••'} mono={!peek} />
              <Fact label="Tops up to" value={peek ? g.sealed.target : '••••••'} mono={!peek} />
              <Fact label="Reserve" value={peek ? g.sealed.reserve : '••••••'} mono={!peek} />
              <p className="text-[13px] text-muted">
                Only you can open these. They were sealed when you set the guard.
              </p>
            </div>
          </>
        ) : view === 'yours' ? (
          <div className="rounded-[20px] border border-line bg-panel px-5 py-6">
            <p className="text-[17px] font-semibold">This position isn't guarded.</p>
            <p className="mt-1 text-muted">Set a guard and a rescue lands in your margin before the liquidator does.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel px-5 py-4">
            <span className="text-[13px] text-muted">What anyone can see on Hyperliquid</span>
            <Fact label="Position" value={`${row.coin} ${row.side.toLowerCase()} · ${row.leverage}×`} />
            <Fact label="Size" value={`${row.size.toLocaleString('en-US')} ${row.coin}`} />
            <Fact label="Mark" value={price(row.mark)} />
            <Fact label="Liquidation" value={row.liquidation === null ? '—' : price(row.liquidation)} red />
            <Fact label="Distance" value={row.distance === null ? '—' : pct(row.distance)} />
            <Fact label="Guarded" value="Can't tell" muted />
            <Fact label="Rescue range" value="••••••" mono muted />
            <Fact label="Reserve" value="••••••" mono muted />
            <p className="text-[13px] text-muted">Your line is public. Your defence isn&apos;t.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
  red,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  red?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line pt-2.5 text-[15px] first-of-type:border-t-0">
      <span className="text-muted">{label}</span>
      <span
        className={`text-right font-medium tabular-nums ${mono ? 'font-mono tracking-[0.2em]' : ''} ${red ? 'text-red' : muted ? 'text-muted' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
