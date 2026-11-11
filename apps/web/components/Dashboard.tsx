'use client';

import Link from 'next/link';
import { useState } from 'react';
import { guardName, guardOf, labelOf, STATE_TEXT, watchedDistance, type ShownGuard } from '../lib/guards';
import type { Holding } from '../lib/hl';
import { price, pct, usd } from './format';
import { GuardCard, type CardState } from './GuardCard';

type View = 'yours' | 'hunter';

export const CARD_STATE: Record<ShownGuard['state'], CardState> = {
  approval: 'draft',
  waiting: 'draft',
  guarded: 'guarded',
};

interface Row extends Holding {
  guard: ShownGuard | null;
}

const newGuardHref = (coin: string) => `/guards/new?coin=${encodeURIComponent(coin)}`;

/** Positions with their guards, and the selected guard in two views: yours (the card) and a hunter's. */
/** One line of what happened on a guard, newest first. */
export interface Activity {
  when: string;
  text: string;
  tone: 'green' | 'amber' | 'muted';
}

/** Amber under 10% from liquidation, red under 5%: the same thresholds everywhere a distance is drawn. */
const barTone = (d: number | null) => (d === null ? 'bg-muted' : d < 5 ? 'bg-red' : d < 10 ? 'bg-amber' : 'bg-muted');
/** Bars read 0–25% from liquidation; anything farther is full. */
const barWidth = (d: number | null) => `${Math.min(100, ((d ?? 25) / 25) * 100)}%`;

export function Dashboard({
  holdings,
  guards,
  activity = [],
}: {
  holdings: Holding[];
  guards: ShownGuard[];
  activity?: Activity[];
}) {
  const [nearestFirst, setNearestFirst] = useState(true);
  const listed: Row[] = holdings.map((h) => ({ ...h, guard: guardOf(h, guards) }));
  const rows = nearestFirst ? [...listed].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)) : listed;
  const firstGuarded = rows.find((r) => r.guard !== null) ?? rows[0]!;
  const [selectedCoin, setSelectedCoin] = useState(firstGuarded.coin);
  const [view, setView] = useState<View>('yours');
  const selected = Math.max(
    0,
    rows.findIndex((r) => r.coin === selectedCoin),
  );
  const setSelected = (i: number) => setSelectedCoin(rows[i]!.coin);
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
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Positions</h2>
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
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-5 py-3.5 text-left tabular-nums ${i === selected ? 'bg-line/70' : ''}`}
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
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${r.guard?.state === 'guarded' ? 'bg-amber' : 'bg-muted'}`}
                  />
                  {r.guard ? STATE_TEXT[r.guard.state] : 'Not guarded'}
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
                <th className="px-3 py-3 text-right font-medium">Margin</th>
                <th className="px-3 py-3 text-right font-medium">Mark</th>
                <th className="px-3 py-3 text-right font-medium">Liquidation</th>
                <th className="min-w-[150px] px-3 py-1.5 font-medium" aria-sort={nearestFirst ? 'ascending' : 'none'}>
                  <button
                    type="button"
                    onClick={() => setNearestFirst((v) => !v)}
                    className="inline-flex min-h-9 items-center gap-1.5 hover:text-text"
                  >
                    Distance
                    <span aria-hidden="true">{nearestFirst ? '↑' : '↕'}</span>
                    <span className="sr-only">{nearestFirst ? ', nearest first' : ', as listed'}</span>
                  </button>
                </th>
                <th className="px-5 py-3 text-right font-medium">Guard</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.coin}
                  className={`cursor-pointer border-t border-line ${i === selected ? 'bg-line/70' : 'hover:bg-line/30'}`}
                  onClick={() => setSelected(i)}
                  aria-selected={i === selected}
                >
                  <td className="px-5 py-4">
                    <button type="button" className="flex flex-col text-left">
                      <span className="font-semibold">{r.coin}-USD</span>
                      <span className="text-[13px] text-muted">
                        {r.side} · {r.leverage}× {r.margin}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-4 text-right">
                    {r.size.toLocaleString('en-US')} {r.coin}
                  </td>
                  <td className="px-3 py-4 text-right">
                    {usd(r.marginUsed)}
                    <span className="block text-[13px] text-muted">{r.margin}</span>
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
                          className={`absolute inset-y-0 left-0 rounded ${barTone(r.distance)}`}
                          style={{ width: barWidth(r.distance) }}
                        />
                      </span>
                      <span className="min-w-[48px] text-right">{r.distance === null ? '—' : pct(r.distance)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {r.guard ? (
                      <Link
                        href={`/guards/${r.guard.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line-3 px-3 py-1 text-[13px] font-medium hover:border-muted"
                      >
                        <span
                          className={`h-[7px] w-[7px] rounded-full ${r.guard.state === 'guarded' ? 'bg-amber' : 'bg-muted'}`}
                        />
                        {STATE_TEXT[r.guard.state]}
                        {r.guard.state === 'guarded' && r.margin === 'isolated' ? ' · isolated' : ''}
                      </Link>
                    ) : (
                      <Link
                        href={newGuardHref(r.coin)}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-block rounded-full bg-text px-3.5 py-1.5 text-[13px] font-semibold text-ground hover:opacity-90"
                      >
                        Guard
                      </Link>
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
            <Link
              href={`/guards/${g.id}`}
              aria-label={`Open the guard: ${guardName(g, holdings).title}`}
              className="block rounded-[28px]"
            >
              <GuardCard
                label={guardName(g, holdings).card}
                distance={(() => {
                  const d = watchedDistance(row, holdings);
                  return d === null ? '—' : pct(d);
                })()}
                sub="from liquidation"
                fingerprint={g.fingerprint}
                commitment={g.commitment}
                state={CARD_STATE[g.state]}
                status={STATE_TEXT[g.state]}
                reserve="••••••"
              />
            </Link>
            <Link
              href={`/guards/${g.id}`}
              className="flex min-h-11 items-center justify-between rounded-[20px] border border-line bg-panel px-5 text-[15px] font-medium hover:border-line-3"
            >
              Open guard
              <span aria-hidden="true" className="text-muted">
                →
              </span>
            </Link>
            {activity.length > 0 && (
              <section
                aria-label="Recent activity"
                className="hidden rounded-[20px] border border-line bg-panel px-5 py-4 md:block"
              >
                <h3 className="text-[15px] font-semibold">Recent activity</h3>
                <ul className="mt-2 flex flex-col">
                  {activity.map((a) => (
                    <li
                      key={a.when + a.text}
                      className="flex items-baseline gap-3 border-t border-line py-2.5 text-[14px] first:border-t-0"
                    >
                      <span
                        className={`h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full ${a.tone === 'green' ? 'bg-green' : a.tone === 'amber' ? 'bg-amber' : 'bg-muted'}`}
                      />
                      <span className="flex-1">{a.text}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-muted">{a.when}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : view === 'yours' ? (
          <div className="flex flex-col items-start gap-3 rounded-[20px] border border-line bg-panel px-5 py-6">
            <p className="text-[17px] font-semibold">This position isn&apos;t guarded.</p>
            <p className="text-muted">Set a guard and a rescue lands in your margin before the liquidator does.</p>
            <Link
              href={newGuardHref(row.coin)}
              className="inline-flex min-h-11 items-center rounded-full bg-text px-6 text-[15px] font-semibold text-ground hover:opacity-90"
            >
              Guard {row.coin} {row.side.toLowerCase()}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel px-5 py-4">
            <span className="text-[13px] text-muted">What anyone can see on Hyperliquid</span>
            <Fact label="Position" value={labelOf(row)} />
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
