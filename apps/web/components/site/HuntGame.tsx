'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUDGET,
  canPush,
  liquidatedWithout,
  price,
  push,
  pushCost,
  sealedLines,
  start,
  tick,
  type Hunt,
} from '../../lib/hunt';
import { distance } from '../../lib/sim';

// "Try to hunt it.": the visitor sells into the book against a guarded ETH long whose liquidation price is public.
// The guard is the enclave's own rules (lib/sim.ts); time runs at 10× (one 3 s tick every 300 ms).

const TICK_MS = 300;
const usd = (x: number) =>
  x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1000)}K` : `$${Math.round(x)}`;
const clock = (t: number) => {
  const s = 14 * 3600 + 20 * 60 + t;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
};

export function HuntGame() {
  const seed = useRef(42);
  const hunt = useRef<Hunt>(start(seed.current));
  const [, setN] = useState(0);
  const [running, setRunning] = useState(false);
  const [without, setWithout] = useState<number | null | undefined>(undefined);
  // "Hunt it for me": sells every time the book allows, the strategy the tests prove never beats the guard.
  const auto = useRef(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const h = hunt.current;
      tick(h);
      if (auto.current && !h.over && canPush(h)) push(h);
      // A hunt ends when the money runs out, the position is gone, or ten minutes of market pass.
      if (!h.over && !canPush(h) && h.spent + pushCost(h) > BUDGET) h.over = 'broke';
      if (h.over) {
        setRunning(false);
        setWithout(liquidatedWithout(h));
      }
      setN((n) => n + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const sell = useCallback(() => {
    const h = hunt.current;
    if (!canPush(h)) return;
    push(h);
    if (!running && !h.over) setRunning(true);
    if (h.over) {
      setRunning(false);
      setWithout(liquidatedWithout(h));
    }
    setN((n) => n + 1);
  }, [running]);

  const again = () => {
    auto.current = false;
    seed.current += 1;
    hunt.current = start(seed.current);
    setRunning(false);
    setWithout(undefined);
    setN((n) => n + 1);
  };

  const h = hunt.current;
  const g = h.guard;
  const p = price(h);
  const d = distance(g.liq, p);
  const done = h.over !== null;
  const W = 640;
  const H = 260;
  const tMax = Math.max(120, h.t + 12);
  const allP = h.pts.map((x) => x[1]).concat(h.liqPts.map((x) => x[1]));
  const lo = Math.min(...allP) * 0.985;
  const hi = Math.max(...allP) * 1.006;
  const x = (t: number) => (t / tMax) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = (pts: [number, number][]) =>
    pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const lines = done ? sealedLines(h) : [];
  const ready = canPush(h);
  // The latest five, with the moments margin appeared kept in: that is what a hunter would notice.
  const margin = h.feed.filter((f) => f.text.startsWith('Margin'));
  const feed = [...new Set([...h.feed.slice(0, 5), ...margin])].sort((a, b) => b.t - a.t).slice(0, 6);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
      <div className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold">
            ETH long · 10× · public liquidation{' '}
            {g.liq.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="font-mono text-[12px] text-muted">{clock(h.t)} · simulated · 10× speed</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-4 h-[240px] w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label="The ETH price you are pushing down, and the public liquidation price."
        >
          <path d={path(h.liqPts)} fill="none" stroke="var(--red)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <path
            d={path(h.pts)}
            fill="none"
            stroke="var(--text)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {lines.map((l, i) => (
            <g key={i} className="reveal-line" style={{ animationDelay: `${i * 160}ms` }}>
              <line
                x1={x(l.from)}
                x2={W}
                y1={y(l.price)}
                y2={y(l.price)}
                stroke="var(--amber)"
                strokeWidth={1.4}
                strokeDasharray="4 6"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {g.rescues
            .filter((r) => r.landedAt !== null)
            .map((r, i) => (
              <circle
                key={i}
                cx={x(r.landedAt!)}
                cy={y(h.pts.find(([t]) => t >= r.landedAt!)?.[1] ?? p)}
                r={5}
                fill="var(--green)"
              />
            ))}
          <circle cx={x(h.t)} cy={y(p)} r={3.5} fill="var(--text)" />
        </svg>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={sell}
            disabled={!ready}
            className="min-h-11 rounded-full bg-text px-5 text-[15px] font-semibold text-ground transition-opacity duration-[120ms] hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {done ? 'Hunt over' : `Sell ${usd(pushCost(h))} into the book`}
          </button>
          <button
            type="button"
            onClick={again}
            className="min-h-11 rounded-full border border-line-3 px-5 text-[15px] font-medium hover:border-muted"
          >
            Start over
          </button>
          {!done && !ready && h.pushes > 0 && <span className="text-[13px] text-muted">The book is refilling…</span>}
          {h.pushes === 0 && !done && (
            <button
              type="button"
              onClick={() => {
                auto.current = true;
                sell();
              }}
              className="min-h-11 rounded-full px-2 text-[15px] font-medium underline decoration-line-3 underline-offset-4 hover:decoration-text"
            >
              Hunt it for me
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 tabular-nums">
          {[
            [`Spent of ${usd(BUDGET)}`, usd(h.spent)],
            ['From liquidation', `${d.toFixed(1)}%`],
            [
              'Margin that appeared',
              g.rescues.filter((r) => r.landedAt !== null).length
                ? `+${Math.round(g.rescues.reduce((s, r) => s + (r.landedAt !== null ? r.amount : 0), 0)).toLocaleString('en-US')} USDC`
                : 'None yet',
            ],
            ['Position', h.over === 'liquidated' ? 'Liquidated' : 'Still open'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[13px] text-muted">{k}</dt>
              <dd
                className={`text-[20px] font-semibold tracking-[-0.01em] ${k === 'Position' && h.over === 'liquidated' ? 'text-red' : ''}`}
              >
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="text-[13px] text-muted">What everyone sees</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px] tabular-nums" aria-live="polite">
            {feed.map((f, i) => (
              <li
                key={`${f.t}-${i}`}
                className={f.text.startsWith('Margin') ? 'text-green' : i === 0 ? 'text-text' : 'text-muted'}
              >
                <span className="font-mono text-muted">{clock(f.t)}</span> {f.text}
              </li>
            ))}
            {h.feed.length === 0 && <li className="text-muted">Nothing yet.</li>}
          </ul>
        </div>
        {done && (
          <div className="rounded-[20px] border border-line p-5" role="status">
            {h.over === 'liquidated' ? (
              <p className="text-[15px]">
                <span className="font-semibold text-red">Liquidated.</span> The price fell past the margin the rescue
                added. A move faster than a rescue can still get through.
              </p>
            ) : (
              <p className="text-[15px]">
                <span className="font-semibold text-green">It held.</span>{' '}
                {without !== undefined && without !== null
                  ? `Without the hidden reserve, your sale #${without} would have liquidated it. `
                  : ''}
                The amber lines are where the guard was set to step in. You couldn&apos;t see them, and each rescue drew
                a new one.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
