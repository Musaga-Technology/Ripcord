'use client';

import { useEffect, useRef, useState } from 'react';
import { GuardCard, type CardState } from '../GuardCard';
import { rangeOf, RescueChart } from '../RescueChart';
import { Ticker } from '../Ticker';
import { Card3D } from './Card3D';
import { distance, gauss, GuardedPosition, rng, type PositionSpec } from '../../lib/sim';

// What a hunter sees, live: price and the public liquidation line, as Hyperliquid shows them to everyone, under the
// sealed card. The guard checks every 3 s with the enclave's own rules; a rescue lands 38 s after it fires (mainnet
// test rescues: 27–46 s). Calm stretches run at 10× speed and the rescue in flight at 3×, so its clock can be read.
// Prices are simulated; the decisions are not. Each run is computed once ahead, so its price range is fixed and the red
// line itself moves when the rescue lands.

const CALM_SPEED = 10;
const FLIGHT_SPEED = 3;
const WINDOW_S = 240;
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
/** Seconds of calm after the chart opens, before the fall starts. */
const CALM_S = 12;
/** How long a run lasts after the save, before the next one. */
const AFTER_SAVE_S = 90;

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
  feed: string;
  flash: { kind: 'rescued' | 'saved'; until: number } | null;
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
    feed: 'No margin changes in the last hour',
    flash: null,
  };
}

/** A run with the chart's window already full of calm, and the price range it will need from start to end. */
function fresh(seed: number): { w: World; lo: number; hi: number } {
  const w = blank(seed);
  for (let i = 0; i < WINDOW_S; i++) step(w);
  // The same seed gives the same run: play a twin to the end for the range, so nothing rescales on screen.
  const twin = blank(seed);
  const prices: number[] = [];
  for (let i = 0; i < 1500 && (twin.savedAt === null || twin.t < twin.savedAt + AFTER_SAVE_S); i++) {
    step(twin);
    prices.push(twin.price, twin.guard.liq);
  }
  const [lo, hi] = rangeOf(prices, 0.12);
  return { w, lo, hi };
}

const clock = (t: number) => {
  const s = 14 * 3600 + 2 * 60 + Math.floor(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600) % 24)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
};
const minClock = (t: number) => clock(t).slice(0, 5);
const fmt = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

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
  } else if (w.t < WINDOW_S + CALM_S) {
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
  const run = useRef<{ w: World; lo: number; hi: number } | null>(null);
  run.current ??= fresh(7);
  const [, setTick] = useState(0);
  const [fade, setFade] = useState(false);
  const [reduced, setReduced] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(reduce);
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
      const w = run.current!.w;
      for (let i = 0; i < 1500 && (w.savedAt === null || w.t < w.savedAt + 30); i++) step(w);
      setTick((n) => n + 1);
      return () => io.disconnect();
    }
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (visible && !document.hidden) {
        const w = run.current!.w;
        acc += dt * (w.guard.inFlight ? FLIGHT_SPEED : CALM_SPEED);
        while (acc >= 1) {
          step(w);
          acc -= 1;
        }
        if (!resetting && w.savedAt !== null && w.t > w.savedAt + AFTER_SAVE_S) {
          resetting = true;
          setFade(true);
          setTimeout(() => {
            seed += 1;
            run.current = fresh(seed);
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

  const { w, lo, hi } = run.current!;
  const g = w.guard;
  const d = distance(g.liq, w.price);
  const flash = w.flash && w.t < w.flash.until ? w.flash.kind : null;
  const f = g.inFlight;
  const settling = !f && !flash && w.landedAt !== null && w.savedAt === null;
  const state: CardState = f ? 'rescuing' : flash ? 'rescued' : 'guarded';
  const status = f ? 'Rescuing…' : flash === 'saved' ? 'Saved' : flash ? 'Rescued' : settling ? 'Settling' : 'Guarded';
  const sub = f
    ? `rescue on its way · ${mmss(w.t - f.firedAt)}`
    : flash === 'rescued' && w.landedAt !== null
      ? `landed in ${GUARD.landS} s`
      : 'from liquidation';
  const last = g.rescues[g.rescues.length - 1];
  const speed = f ? FLIGHT_SPEED : CALM_SPEED;

  return (
    <div ref={box} className={`relative transition-opacity duration-[600ms] ${fade ? 'opacity-0' : 'opacity-100'}`}>
      <div className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="text-[15px] font-semibold">What a hunter sees</span>
          <span className="font-mono text-[12px] text-muted">
            ETH-USD · {clock(w.t)} · simulated{reduced ? '' : ` · ${speed}× speed`}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[15px] tabular-nums">
          <span className="text-muted">
            Mark <span className="text-text">{fmt(w.price)}</span>
          </span>
          <span className="flex items-center gap-2 text-red">
            <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-red" />
            Liq {fmt(g.liq)}
          </span>
          <span className="text-muted">{d.toFixed(1)}% away</span>
        </div>
        <p className="mt-1.5 truncate text-[13px] text-muted tabular-nums" aria-live="polite">
          {w.feed}
        </p>
        <div className="mt-4">
          <RescueChart
            pts={w.pts}
            t0={w.t - WINDOW_S}
            t1={w.t}
            lo={lo}
            hi={hi}
            liq={g.liq}
            oldLiq={w.oldLiq}
            landed={w.landedAt !== null ? [w.landedAt, w.landedPrice] : null}
            timeLabel={minClock}
            label="A simulated ETH price falling toward its public liquidation price; a hidden rescue moves the liquidation price away just in time."
          />
        </div>
      </div>
      <div className="relative z-10 mx-auto -mt-6 w-[88%] max-w-[420px] sm:absolute sm:-bottom-28 sm:-left-14 sm:mt-0 sm:w-[min(400px,62%)] lg:-left-24">
        <Card3D>
          <GuardCard
            label="ETH long · 10×"
            distance={<Ticker value={d} suffix="%" />}
            sub={sub}
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
