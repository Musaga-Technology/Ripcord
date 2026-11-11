'use client';

// Guards home (docs/DESIGN.md §4.2), a tool rather than a dashboard: first where the account stands and the one next
// step (finish a guard, guard the nearest unguarded position, or nothing to do), beside the nearest guard's card; then
// the positions, nearest to liquidation first, each with its guard or a Guard button. Hunter's view shows the same
// list as anyone sees it on Hyperliquid: every liquidation price, and "Can't tell" where the guard would be.
import Link from 'next/link';
import { useState } from 'react';
import { guardName, guardOf, STATE_TEXT, watchedDistance, type ShownGuard } from '../lib/guards';
import type { Holding } from '../lib/hl';
import { price, pct, usd } from './format';
import { GuardCard, type CardState } from './GuardCard';
import { Now } from './Now';

type View = 'yours' | 'hunter';

export const CARD_STATE: Record<ShownGuard['state'], CardState> = {
  approval: 'draft',
  waiting: 'draft',
  guarded: 'guarded',
};

interface Row extends Holding {
  guard: ShownGuard | null;
}

/** One line of what happened on a guard, newest first. */
export interface Activity {
  when: string;
  text: string;
  tone: 'green' | 'amber' | 'muted';
}

const newGuardHref = (coin: string) => `/guards/new?coin=${encodeURIComponent(coin)}`;
const named = (r: Holding) => `${r.coin} ${r.side.toLowerCase()}`;

/** Amber under 10% from liquidation, red under 5%: the same thresholds everywhere a distance is drawn. */
const barTone = (d: number | null) => (d === null ? 'bg-muted' : d < 5 ? 'bg-red' : d < 10 ? 'bg-amber' : 'bg-muted');
/** Bars read 0–25% from liquidation; anything farther is full. */
const barWidth = (d: number | null) => `${Math.min(100, ((d ?? 25) / 25) * 100)}%`;

const primary =
  'inline-flex min-h-11 items-center rounded-full bg-text px-6 text-[15px] font-semibold text-ground hover:opacity-90';
const quiet =
  'inline-flex min-h-11 items-center text-[15px] underline decoration-line-3 underline-offset-4 hover:text-text';

/** What matters most right now, in order: a guard left half set up, the nearest unguarded position, or nothing. */
function nowOf(rows: Row[], demo: boolean) {
  const unfinished = rows.find((r) => r.guard && r.guard.state !== 'guarded');
  const unguarded = rows.filter((r) => !r.guard);
  const guarded = rows.filter((r) => r.guard?.state === 'guarded');
  const watch = guarded[0];
  const crash = demo && watch ? { label: 'Watch a rescue: try a crash', href: `/guards/${watch.guard!.id}` } : null;
  if (unfinished) {
    const g = unfinished.guard!;
    return {
      title: `Finish your ${named(unfinished)} guard.`,
      body:
        g.state === 'approval'
          ? 'It needs one approval on Hyperliquid before a rescue can reach this isolated position.'
          : 'It starts guarding once its reserve arrives. Nothing is on chain until then.',
      action: { label: 'Finish setting up', href: `/guards/${g.id}` },
      second: null,
    };
  }
  const next = unguarded[0];
  if (next) {
    const d = next.distance === null ? '' : `, ${pct(next.distance)} from liquidation`;
    const away = next.distance === null ? '' : `, ${pct(next.distance)} away`;
    return {
      title: guarded.length === 0 ? 'None of your positions is guarded.' : `${named(next)} isn’t guarded${d}.`,
      body:
        guarded.length === 0
          ? `${named(next)} is the nearest to liquidation${away}. A guard keeps a hidden reserve that tops up its margin before the liquidator gets there.`
          : `${guarded.length} of ${rows.length} positions are guarded. Guard this one next: it's the nearest without one.`,
      action: { label: `Guard ${named(next)}`, href: newGuardHref(next.coin) },
      second: crash,
    };
  }
  const nearest = rows[0]!;
  return {
    title: 'Every position is guarded.',
    body: `${named(nearest)} is the nearest to liquidation${nearest.distance === null ? '' : `, ${pct(nearest.distance)} away`}. If the price runs at it, its hidden reserve adds margin first. Nothing to do now.`,
    action: null,
    second: crash,
  };
}

export function Dashboard({
  holdings,
  guards,
  activity = [],
  value,
  rescues,
  demo = true,
}: {
  holdings: Holding[];
  guards: ShownGuard[];
  activity?: Activity[];
  /** Account value, for the Now panel's facts. */
  value?: number;
  /** Rescues in the last 30 days, in words ("2 · 1 saved"). */
  rescues?: string;
  demo?: boolean;
}) {
  const [view, setView] = useState<View>('yours');
  const rows: Row[] = holdings
    .map((h) => ({ ...h, guard: guardOf(h, guards) }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  const guardedCount = rows.filter((r) => r.guard?.state === 'guarded').length;
  const now = nowOf(rows, demo);
  const featured = rows.find((r) => r.guard?.state === 'guarded') ?? rows.find((r) => r.guard);
  const hunter = view === 'hunter';

  const facts: [string, string][] = [
    ...(value === undefined ? [] : ([['Account value', usd(value, 2)]] as [string, string][])),
    ['Guarded', `${guardedCount} of ${rows.length} positions`],
    ...(rescues === undefined ? [] : ([['Rescues · 30 days', rescues]] as [string, string][])),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className={`min-w-0 ${featured?.guard ? '' : 'lg:col-span-2'}`}>
          <Now
            title={now.title}
            facts={facts}
            action={
              now.action || now.second ? (
                <>
                  {now.action && (
                    <Link href={now.action.href} className={primary}>
                      {now.action.label}
                    </Link>
                  )}
                  {now.second && (
                    <Link href={now.second.href} className={now.action ? quiet : primary}>
                      {now.second.label}
                    </Link>
                  )}
                </>
              ) : undefined
            }
          >
            {now.body}
          </Now>
        </div>
        {featured?.guard && (
          <Link
            href={`/guards/${featured.guard.id}`}
            aria-label={`Open the guard: ${guardName(featured.guard, holdings).title}`}
            className="block rounded-[28px]"
          >
            <GuardCard
              label={guardName(featured.guard, holdings).card}
              distance={(() => {
                const d = watchedDistance(featured, holdings);
                return d === null ? '—' : pct(d);
              })()}
              sub="from liquidation"
              fingerprint={featured.guard.fingerprint}
              commitment={featured.guard.commitment}
              state={CARD_STATE[featured.guard.state]}
              status={STATE_TEXT[featured.guard.state]}
              reserve="••••••"
            />
          </Link>
        )}
      </div>

      <section aria-label="Positions" className="overflow-hidden rounded-[20px] border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Your positions</h2>
            <span className="text-[13px] text-muted">
              {hunter
                ? 'As anyone sees them on Hyperliquid: every liquidation price, and no sign of a guard.'
                : 'Nearest to liquidation first.'}
            </span>
          </div>
          <div role="group" aria-label="View" className="flex w-fit gap-1 rounded-full border border-line p-1">
            {(['yours', 'hunter'] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`min-h-9 rounded-full px-3.5 text-[13px] font-medium ${view === v ? 'bg-text text-ground' : 'text-text-2 hover:text-text'}`}
              >
                {v === 'yours' ? 'Your view' : "Hunter's view"}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(150px,auto)] gap-4 px-5 pb-1 pt-3 text-[13px] text-muted md:grid">
          <span>Position</span>
          <span>From liquidation</span>
          <span className="text-right">Liquidation</span>
          <span className="text-right">Guard</span>
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.coin}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-line px-5 py-4 first:border-t-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(150px,auto)] md:first:border-t"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{named(r)}</span>
                <span className="truncate text-[13px] text-muted">
                  {r.leverage}× {r.margin} · {r.size.toLocaleString('en-US')} {r.coin} · {usd(r.marginUsed)} margin
                </span>
              </span>
              <span className="col-span-2 row-start-2 flex items-center gap-3 tabular-nums md:col-span-1 md:row-start-auto">
                <span className="relative h-1 w-full max-w-[140px] overflow-hidden rounded bg-line">
                  <span
                    className={`absolute inset-y-0 left-0 rounded ${barTone(r.distance)}`}
                    style={{ width: barWidth(r.distance) }}
                  />
                </span>
                <span className="min-w-[52px]">{r.distance === null ? '—' : pct(r.distance)}</span>
                <span className="text-[13px] text-muted md:hidden">
                  · Liq {r.liquidation === null ? '—' : price(r.liquidation)}
                </span>
              </span>
              <span className="hidden flex-col items-end tabular-nums md:flex">
                <span className="flex items-center gap-2 text-red">
                  <span aria-hidden="true" className="h-[2px] w-[10px] rounded bg-red" />
                  {r.liquidation === null ? '—' : price(r.liquidation)}
                </span>
                <span className="text-[13px] text-muted">Mark {price(r.mark)}</span>
              </span>
              <span className="col-start-2 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
                {hunter ? (
                  <span className="text-[13px] text-muted">Can&apos;t tell</span>
                ) : r.guard ? (
                  <Link
                    href={`/guards/${r.guard.id}`}
                    className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border border-line-3 px-3 text-[13px] font-medium hover:border-muted"
                  >
                    <span
                      className={`h-[7px] w-[7px] rounded-full ${r.guard.state === 'guarded' ? 'bg-amber' : 'bg-muted'}`}
                    />
                    {r.guard.state === 'guarded' ? 'Guarded' : 'Finish set-up'}
                    <span aria-hidden="true" className="text-muted">
                      →
                    </span>
                  </Link>
                ) : (
                  <Link
                    href={newGuardHref(r.coin)}
                    className="inline-flex min-h-9 items-center rounded-full bg-text px-4 text-[13px] font-semibold text-ground hover:opacity-90"
                  >
                    Guard
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
        {hunter && (
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Your line is public. Your defence isn&apos;t: whether a position is guarded, where it steps in and how big
            the reserve is stay sealed.
          </p>
        )}
      </section>

      {activity.length > 0 && (
        <section aria-label="Recent activity" className="rounded-[20px] border border-line bg-panel px-5 py-4">
          <h2 className="text-[15px] font-semibold">Recent activity</h2>
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
    </div>
  );
}
