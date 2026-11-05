'use client';

import { useEffect, useRef, useState } from 'react';
import { GuardCard, type CardState } from '../GuardCard';
import { Card3D } from './Card3D';
import { distance, gauss, GuardedPosition, rng, type PositionSpec } from '../../lib/sim';

// What a hunter sees, live: price and the public liquidation line, as Hyperliquid shows them to everyone, under the
// sealed card. The guard checks every 3 s with the enclave's own rules; a rescue lands 38 s after it fires (mainnet
// test rescues: 27–46 s). Shown at 10× speed. Prices are simulated; the decisions are not.

const SPEED = 10;
const WINDOW_S = 300;
const POS: PositionSpec = { side: 1, entry: 2460, notional: 32_900, leverage: 10, mm: 0.02 };
const GUARD = {
  lineRange: [4.4, 5.6] as [number, number],
  targetRange: [8.0, 9.4] as [number, number],
  speedAware: true,
  reserveX: 1,
  landS: 38,
  cooldownS: 60,
};
const COMMITMENT = '7f3a91c2e04b5d18a6f2c3b9d07e41a2b6c8d9e0f1a2b3c4d5e6f708192ac91e';

interface World {
  t: number;
  price: number;
  pts: [number, number][];
  guard: GuardedPosition;
  u: () => number;
  oldLiq: number | null;
  landedAt: number | null;
  landedPrice: number;
  savedAt: number | null;
  liqShown: number;
  yLo: number;
  yHi: number;
  feed: string;
  flash: { kind: 'rescued' | 'saved'; until: number } | null;
}

/** A new run, with five calm minutes already behind it so the chart opens full. */
function fresh(seed: number): World {
  const w = blank(seed);
  for (let i = 0; i < WINDOW_S; i++) step(w);
  w.yLo = Math.min(...w.pts.map((p) => p[1]), w.guard.liq) * 0.994;
  w.yHi = Math.max(...w.pts.map((p) => p[1])) * 1.004;
  return w;
}

function blank(seed: number): World {
  const u = rng(seed);
  const guard = new GuardedPosition(POS, GUARD, u);
  const price = POS.entry * (1 + (u() - 0.5) * 0.004);
  return {
    t: 0,
    price,
    pts: [[0, price]],
    guard,
    u,
    oldLiq: null,
    landedAt: null,
    landedPrice: 0,
    savedAt: null,
    liqShown: guard.liq,
    yLo: guard.liq * 0.985,
    yHi: price * 1.01,
    feed: 'No margin changes in the last hour',
    flash: null,
  };
}

const clock = (t: number) => {
  const s = 14 * 3600 + 2 * 60 + Math.floor(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600) % 24)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
};
const fmt = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One simulated second: the choreographed market, and a check every 3 s. */
function step(w: World) {
  const g = w.guard;
  const f = g.inFlight;
  let target: number;
  let k = 0.03;
  if (w.savedAt !== null) {
    target = POS.entry * 0.975;
    k = 0.02;
  } else if (w.landedAt !== null && w.oldLiq !== null) {
    target = w.oldLiq * 0.988; // the wick goes past the old liquidation price: the rescue was a save
    k = 0.045;
  } else if (f) {
    target = f.liqBefore * 1.012;
  } else if (w.t < WINDOW_S + 40) {
    target = POS.entry * 0.993;
    k = 0.02;
  } else {
    target = g.liq * 1.02;
  }
  w.price += k * (target - w.price) + 0.0007 * w.price * gauss(w.u);
  if (f) w.price = Math.max(w.price, g.liq * 1.004);
  w.t += 1;
  w.pts.push([w.t, w.price]);
  while (w.pts.length && w.pts[0]![0] < w.t - WINDOW_S - 5) w.pts.shift();
  if (w.t % 3 !== 0) return;
  const before = g.liq;
  const ev = g.observe(w.t, w.price);
  if (ev === 'landed') {
    w.oldLiq = before;
    w.landedAt = w.t;
    w.landedPrice = w.price;
    const r = g.rescues[g.rescues.length - 1]!;
    w.feed = `${clock(w.t)} · Margin added: +${Math.round(r.amount).toLocaleString('en-US')} USDC · from: unknown`;
    w.flash = { kind: 'rescued', until: w.t + 20 };
  }
  if (w.savedAt === null && g.rescues.some((r) => r.outcome === 'saved')) {
    w.savedAt = w.t;
    w.flash = { kind: 'saved', until: w.t + 40 };
  }
}

export function HeroLive() {
  const world = useRef<World | null>(null);
  world.current ??= fresh(7);
  const [, setTick] = useState(0);
  const [fade, setFade] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let visible = true;
    let seed = 7;
    let resetting = false;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    if (box.current) io.observe(box.current);
    if (reduce) {
      // One still frame of the end state: guarded, after a rescue that saved the position.
      const w = world.current!;
      for (let i = 0; i < 900 && (w.savedAt === null || w.t < w.savedAt + 30); i++) step(w);
      setTick((n) => n + 1);
      return () => io.disconnect();
    }
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (visible && !document.hidden) {
        acc += dt * SPEED;
        const w = world.current!;
        while (acc >= 1) {
          step(w);
          acc -= 1;
        }
        // The public line slides away when the credit lands (DESIGN §8.1: 420 ms at 1×).
        w.liqShown += (w.guard.liq - w.liqShown) * Math.min(1, dt / 0.14);
        const vis = w.pts.filter(([t]) => t >= w.t - WINDOW_S);
        const lo = Math.min(...vis.map((p) => p[1]), w.liqShown, w.oldLiq ?? Infinity) * 0.994;
        const hi = Math.max(...vis.map((p) => p[1])) * 1.004;
        w.yLo = Math.min(lo, w.yLo + (lo - w.yLo) * Math.min(1, dt * 2));
        w.yHi += (hi - w.yHi) * Math.min(1, dt * 2);
        if (!resetting && w.savedAt !== null && w.t > w.savedAt + 120) {
          resetting = true;
          setFade(true);
          setTimeout(() => {
            seed += 1;
            world.current = fresh(seed);
            setFade(false);
            resetting = false;
          }, 600);
        }
        setTick((n) => (n + 1) % 1_000_000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  const w = world.current!;
  const g = w.guard;
  const W = 600;
  const H = 300;
  const x = (t: number) => ((t - (w.t - WINDOW_S)) / WINDOW_S) * W;
  const y = (p: number) => H - ((p - w.yLo) / (w.yHi - w.yLo)) * H;
  const vis = w.pts.filter(([t]) => t >= w.t - WINDOW_S - 2);
  const line = vis.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const area = `${line} L${x(w.t).toFixed(1)} ${H} L${x(vis[0]?.[0] ?? 0).toFixed(1)} ${H}Z`;
  const d = distance(g.liq, w.price);
  const flash = w.flash && w.t < w.flash.until ? w.flash.kind : null;
  const state: CardState = g.phase === 'rescuing' ? 'rescuing' : flash ? 'rescued' : 'guarded';
  const status = g.phase === 'rescuing' ? 'Rescuing…' : flash === 'saved' ? 'Saved' : flash ? 'Rescued' : 'Guarded';
  const last = g.rescues[g.rescues.length - 1];
  const landX = w.landedAt !== null ? x(w.landedAt) : null;

  return (
    <div ref={box} className={`relative transition-opacity duration-[600ms] ${fade ? 'opacity-0' : 'opacity-100'}`}>
      <div className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="text-[15px] font-semibold">What a hunter sees</span>
          <span className="font-mono text-[12px] text-muted">{clock(w.t)} · simulated · 10× speed</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[15px] tabular-nums">
          <span className="text-muted">
            Mark <span className="text-text">{fmt(w.price)}</span>
          </span>
          <span className="text-red">Liq ─ {fmt(g.liq)}</span>
          <span className="text-muted">{d.toFixed(1)}% away</span>
        </div>
        <p className="mt-1.5 truncate text-[13px] text-muted tabular-nums" aria-live="polite">
          {w.feed}
        </p>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-4 h-[240px] w-full sm:h-[300px]"
          preserveAspectRatio="none"
          role="img"
          aria-label="A simulated ETH price falling toward its public liquidation price; a hidden rescue moves the liquidation price away just in time."
        >
          <path d={area} fill="var(--text)" fillOpacity={0.018} />
          <path
            d={line}
            fill="none"
            stroke="var(--text)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          {w.oldLiq !== null && (
            <line
              x1={0}
              x2={W}
              y1={y(w.oldLiq)}
              y2={y(w.oldLiq)}
              stroke="var(--red)"
              strokeWidth={1}
              strokeDasharray="6 6"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <line
            x1={0}
            x2={W}
            y1={y(w.liqShown)}
            y2={y(w.liqShown)}
            stroke="var(--red)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {landX !== null && landX > 0 && (
            <g transform={`translate(${landX.toFixed(1)} ${y(w.landedPrice).toFixed(1)})`}>
              <circle r={5} fill="var(--green)" />
              <circle
                r={5}
                fill="none"
                stroke="var(--green)"
                strokeWidth={2}
                className="land-ring"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
          <circle cx={x(w.t)} cy={y(w.price)} r={3.5} fill="var(--text)" />
        </svg>
      </div>
      <div className="relative z-10 mx-auto -mt-6 w-[88%] max-w-[420px] sm:absolute sm:-bottom-16 sm:-left-14 sm:mt-0 sm:w-[min(400px,62%)] lg:-left-24">
        <Card3D>
          <GuardCard
            label="ETH long · 10×"
            distance={`${d.toFixed(1)}%`}
            sub={g.phase === 'rescuing' ? 'rescue on its way' : 'from liquidation'}
            fingerprint="7F3A 91C2 ···· C91E"
            commitment={COMMITMENT}
            state={state}
            status={status}
            reserve="••••••"
            print
            depth
          />
        </Card3D>
      </div>
      {last && <span className="sr-only">Last rescue: {Math.round(last.amount)} USDC.</span>}
    </div>
  );
}
