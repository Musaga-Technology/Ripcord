'use client';

import { useEffect, useRef, useState } from 'react';
import { GuardCard, type CardState } from '../GuardCard';
import { RescueChart } from '../RescueChart';
import { Ticker } from '../Ticker';
import { Card3D } from './Card3D';
import { clockOf, GUARD, HeroRun, WINDOW_S } from '../../lib/heroRun';
import { distance } from '../../lib/sim';

// What a hunter sees, on the real Oct 10, 2025 crash: ETH's price and the public liquidation line of a 10× long, as
// anyone sees them, under the sealed card. The guard decides with the enclave's own rules (lib/heroRun.ts); the run
// plays at 20× speed and slows to 4× while a rescue is in flight, so its clock can be read.

const CALM_SPEED = 20;
const FLIGHT_SPEED = 4;
const COMMITMENT = '7f3a91c2e04b5d18a6f2c3b9d07e41a2b6c8d9e0f1a2b3c4d5e6f708192ac91e';
const RANGE = HeroRun.range();

const fmt = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function HeroLive() {
  const run = useRef<HeroRun | null>(null);
  run.current ??= new HeroRun();
  const [, setTick] = useState(0);
  const [fade, setFade] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(reduce);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let visible = true;
    let resetting = false;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    if (box.current) io.observe(box.current);
    if (reduce) {
      // One still frame: after the wick, the position still open.
      const w = run.current!;
      while (!w.over) w.step();
      setTick((n) => n + 1);
      return () => io.disconnect();
    }
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (visible && !document.hidden && !pausedRef.current) {
        const w = run.current!;
        // Slow while a rescue is in flight and for the beat after it lands, so both can be read.
        const landing = w.landings[w.landings.length - 1];
        const slow = w.guard.inFlight || (landing !== undefined && w.t < landing.t + 25);
        acc += dt * (slow ? FLIGHT_SPEED : CALM_SPEED);
        while (acc >= 1 && !w.over) {
          w.step();
          acc -= 1;
        }
        if (!resetting && w.over) {
          resetting = true;
          setTimeout(() => setFade(true), 2500);
          setTimeout(() => {
            run.current = new HeroRun();
            setFade(false);
            resetting = false;
          }, 3100);
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

  const w = run.current!;
  const g = w.guard;
  const d = distance(g.liq, w.price);
  const f = g.inFlight;
  const lastLanding = w.landings[w.landings.length - 1];
  const justLanded = lastLanding !== undefined && w.t < lastLanding.t + 25;
  const saved = w.savedAt !== null && w.unguardedAt !== null;
  const settling = !f && !justLanded && !saved && lastLanding !== undefined;
  const state: CardState = f ? 'rescuing' : justLanded || saved ? 'rescued' : 'guarded';
  const status = f ? 'Rescuing…' : justLanded ? 'Rescued' : saved ? 'Saved' : settling ? 'Settling' : 'Guarded';
  const sub = f
    ? `rescue on its way · ${mmss(w.t - f.firedAt)}`
    : justLanded
      ? `landed in ${GUARD.landS} s`
      : 'from liquidation';

  return (
    <div ref={box} className={`relative transition-opacity duration-[600ms] ${fade ? 'opacity-0' : 'opacity-100'}`}>
      <div className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="text-[15px] font-semibold">What a hunter sees</span>
          <span className="flex items-center gap-3">
            <span className="font-mono text-[12px] text-muted">
              ETH-USD · Oct 10, 2025 · {clockOf(w.t)} UTC
              {reduced ? '' : ` · ${f || justLanded ? FLIGHT_SPEED : CALM_SPEED}×`}
            </span>
            {!reduced && (
              <button
                type="button"
                onClick={() => setPaused((v) => !v)}
                aria-pressed={paused}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-3 px-2.5 text-[12px] text-text-2 hover:border-muted"
              >
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  {paused ? <path d="M2 1l7 4-7 4z" /> : <path d="M2 1h2v8H2zM6 1h2v8H6z" />}
                </svg>
                {paused ? 'Play' : 'Pause'}
              </button>
            )}
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
        <p
          className={`mt-1.5 text-[13px] tabular-nums ${w.unguardedAt !== null ? 'text-[15px] font-medium text-text' : 'truncate text-muted'}`}
          aria-live="polite"
        >
          {w.unguardedAt !== null
            ? `Without the hidden reserve, liquidated at ${clockOf(w.unguardedAt)}. With it, still open.`
            : w.feed}
        </p>
        <div className="mt-4">
          <RescueChart
            pts={w.pts()}
            t0={w.t - WINDOW_S}
            t1={w.t}
            lo={RANGE[0]}
            hi={RANGE[1]}
            liq={g.liq}
            oldLiq={w.landings.length ? w.unguardedLiq : null}
            landed={w.landings.map((l): [number, number] => [l.t, l.price])}
            marks={
              w.unguardedAt !== null
                ? [{ t: w.unguardedAt, price: w.unguardedLiq, label: 'Liquidated here without Ripcord' }]
                : []
            }
            timeLabel={(t) => clockOf(t).slice(0, 5)}
            label="ETH's real price on Oct 10, 2025 falling through the public liquidation price of a 10× long; hidden rescues move the liquidation price away before the price reaches it."
          />
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-[1.5] text-muted xl:ml-auto xl:max-w-[55%] xl:text-right">
        Real prices: Binance ETH perpetual, 1-minute bars. The guard&apos;s real rules, a reserve the size of the
        margin, and the 38 s a rescue took on mainnet.
      </p>
      <div className="relative z-10 mx-auto mt-6 w-[88%] max-w-[420px] xl:absolute xl:-bottom-28 xl:-left-24 xl:mt-0 xl:w-[min(400px,62%)]">
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
      {lastLanding && <span className="sr-only">Last rescue: {Math.round(lastLanding.amount)} USDC.</span>}
    </div>
  );
}
