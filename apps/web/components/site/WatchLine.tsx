'use client';

import { rescueSize } from '@ripcord/shared';
import { rng } from '../../lib/sim';
import { useInView } from './Reveal';

// "Watch the line move.": a wick to 2,205 that would have liquidated an ETH long at 2,231. Two hidden rescues step
// the public liquidation line down out of reach, and only the first is a save. The rescue sizes come from the shared
// rules; the landing times are the ones measured on mainnet (38 s, 41 s).

const G = { entry: 2452.1, size: 12.4, mm: 0.02, margin: 3290.09, reserve: 4150 };
const liqOf = (m: number) => (G.entry - m / G.size) / (1 - G.mm);

function build() {
  let r = rng(3);
  const base: number[] = [];
  let v = 2446;
  for (let i = 0; i < 60; i++) {
    v += (2458 - v) * 0.05 + (r() - 0.5) * 5.4;
    base.push(v);
  }
  const s2 = 2461.2 - base[59]!;
  for (let i = 0; i < 60; i++) base[i]! += s2 * (i / 59);
  r = rng(5);
  const wick: number[] = [];
  let u = base[59]!;
  for (let i = 0; i < 26; i++) {
    u += (2268 - u) * 0.11 + (r() - 0.55) * 7;
    wick.push(u);
  }
  for (const p of [2252, 2238, 2224, 2213, 2206, 2205]) wick.push(p + (r() - 0.5) * 1.5);
  wick.push(2209, 2214, 2211);
  for (let i = 0; i < 28; i++) {
    u = wick[wick.length - 1]!;
    u += (2412 - u) * 0.13 + (r() - 0.45) * 6;
    wick.push(u);
  }
  const all = base.concat(wick);
  const N = all.length;
  const g = rng(11);
  const drawn = () => ({ line: 5 + g() * 3, target: 9 + g() * 4 });
  let margin = G.margin;
  let reserve = G.reserve;
  let liq = liqOf(margin);
  let d = drawn();
  let pending: { at: number; t: number; lat: number } | null = null;
  let cool = -1;
  const steps = [{ i: 0, liq }];
  const marks: { i: number; p: number; label: string }[] = [];
  for (let i = 60; i < N; i++) {
    const p = all[i]!;
    if (pending && i >= pending.at) {
      margin += pending.t;
      reserve -= pending.t;
      liq = liqOf(margin);
      steps.push({ i, liq });
      marks.push({ i, p, label: `+${Math.round(pending.t).toLocaleString('en-US')} USDC · ${pending.lat} s` });
      pending = null;
      cool = i + 3;
      d = drawn();
    } else if (!pending && i >= cool && ((p - liq) / p) * 100 < d.line) {
      const dist = ((p - liq) / p) * 100;
      const t = rescueSize({
        drawn_target: d.target,
        distance: dist,
        mark: p,
        szi: G.size,
        maint_frac: G.mm,
        max_rescue_usd: reserve,
        budget_left_usd: reserve,
        reserve_usd: reserve,
      });
      if (t) pending = { at: i + 1, t, lat: [38, 41][marks.length] ?? 40 };
    }
  }
  const X = (i: number) => (i / (N - 1)) * 1000;
  const Y = (p: number) => 20 + (1 - (p - 1940) / 560) * 360;
  const price = all.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(' ');
  let liqPath = `M0 ${Y(steps[0]!.liq).toFixed(1)}`;
  for (let k = 1; k < steps.length; k++) {
    liqPath += `L${X(steps[k]!.i).toFixed(1)} ${Y(steps[k - 1]!.liq).toFixed(1)}L${X(steps[k]!.i).toFixed(1)} ${Y(steps[k]!.liq).toFixed(1)}`;
  }
  liqPath += `L1000 ${Y(steps[steps.length - 1]!.liq).toFixed(1)}`;
  return { price, liqPath, marks: marks.map((m) => ({ x: X(m.i), y: Y(m.p), label: m.label })), oldY: Y(2231.4), N };
}

const C = build();
const DUR = 6.5;

export function WatchLine() {
  const [ref, seen] = useInView<HTMLDivElement>('-25% 0px');
  return (
    <div ref={ref} className={`watch ${seen ? 'play' : ''}`} style={{ ['--dur' as string]: `${DUR}s` }}>
      <svg
        viewBox="0 0 1000 400"
        className="h-auto w-full"
        role="img"
        aria-label="ETH wicks to 2,205, past the old liquidation price of 2,231. Two hidden rescues step the liquidation price down before the wick reaches it."
      >
        <defs>
          <clipPath id="watch-clip">
            <rect className="watch-wipe" x="0" y="0" width="1000" height="400" />
          </clipPath>
        </defs>
        <line
          x1="0"
          x2="1000"
          y1={C.oldY}
          y2={C.oldY}
          stroke="var(--red)"
          strokeWidth="1"
          strokeDasharray="6 6"
          opacity=".45"
          vectorEffect="non-scaling-stroke"
        />
        <text x="8" y={C.oldY - 8} fill="var(--red)" fontSize="13" opacity=".8">
          Old liquidation 2,231
        </text>
        <g clipPath="url(#watch-clip)">
          <path d={`${C.price} L1000 400 L0 400Z`} fill="var(--text)" fillOpacity=".022" />
          <path
            d={C.price}
            fill="none"
            stroke="var(--text)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path d={C.liqPath} fill="none" stroke="var(--red)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </g>
        {C.marks.map((m) => (
          <g
            key={m.x}
            className="watch-mark"
            style={{ animationDelay: `calc(var(--dur) * ${(m.x / 1000).toFixed(3)})` }}
          >
            <circle cx={m.x} cy={m.y} r="6" fill="var(--green)" />
            <text
              x={m.x}
              y={m.y - 18}
              fill="var(--green)"
              fontSize="14"
              fontWeight="600"
              textAnchor="middle"
              className="tabular-nums"
            >
              {m.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted">
        <span className="inline-flex items-center gap-2">
          <i className="h-[2px] w-5 bg-text" /> ETH price
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-[2px] w-5 bg-red" /> Liquidation price, public
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="h-2 w-2 rounded-full bg-green" /> Rescue landed
        </span>
        <span>Simulated on Hyperliquid&apos;s liquidation rules</span>
      </div>
    </div>
  );
}
