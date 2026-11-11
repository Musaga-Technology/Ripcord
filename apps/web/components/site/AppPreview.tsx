'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { guardsFor } from '../../lib/guards';
import { demoAccount } from '../../lib/session';
import { DEMO_TRADER } from '@ripcord/shared/mock';
import { Dashboard } from '../Dashboard';
import { GuardCard } from '../GuardCard';

// "This is the app.": the real app's own components on the example account, framed the way they appear on a desktop
// and a phone. Not a screenshot: the same Dashboard and card the app renders, made inert here, with one focus move as
// they arrive (blur and drift settle in 600 ms). Content is visible as rendered; only a frame that starts below the
// fold waits to arrive.

function useArrive<T extends Element>() {
  const ref = useRef<T>(null);
  const [state, setState] = useState<'shown' | 'armed' | 'in'>('shown');
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight) return;
    setState('armed');
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        setState('in');
      },
      { rootMargin: '0px 0px -15% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, state === 'armed' ? 'arrive' : state === 'in' ? 'arrive in' : ''] as const;
}

const account = demoAccount();
const guards = guardsFor(DEMO_TRADER, true, []);
const hype = guards.find((g) => g.coin === 'HYPE')!;

export function AppPreview() {
  const [desk, deskCls] = useArrive<HTMLDivElement>();
  const [phone, phoneCls] = useArrive<HTMLDivElement>();
  return (
    <div className="relative">
      <div
        ref={desk}
        className={`${deskCls} overflow-hidden rounded-[20px] border border-line bg-ground shadow-[0_24px_60px_-28px_rgb(0_0_0/0.6)]`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3 text-[13px] text-muted">
          <span className="font-medium text-text">Guards</span>
          <span className="font-mono">0x9c4e…41f2</span>
        </div>
        {/* Laid out at the app's own width and drawn smaller, so the table reads as it does in the app. */}
        <div inert className="pointer-events-none p-5 lg:[zoom:0.86] [&_*]:!transition-none">
          <Dashboard holdings={account.holdings} guards={guards} />
        </div>
      </div>
      <div
        ref={phone}
        className={`${phoneCls} relative z-10 mx-auto -mt-10 w-[300px] max-w-full rounded-[40px] border border-line-3 bg-ground p-3 shadow-[0_28px_70px_-24px_rgb(0_0_0/0.7)] lg:absolute lg:-bottom-28 lg:right-6 lg:mt-0`}
        style={{ animationDelay: '120ms' }}
      >
        <div inert className="pointer-events-none flex flex-col gap-3 rounded-[30px] bg-ground px-3 pb-4 pt-5">
          <span className="text-[17px] font-semibold tracking-[-0.02em]">HYPE long · 3× isolated</span>
          <span className="flex items-center gap-2 text-[13px] text-text-2">
            <span className="chip-pulse h-[7px] w-[7px] rounded-full bg-amber" />
            Rescuing… 0:23 · 6,783 USDC on its way
          </span>
          <GuardCard
            label="HYPE long · 3× isolated"
            distance="4.1%"
            sub="rescue on its way · 0:23"
            fingerprint={hype.fingerprint}
            commitment={hype.commitment}
            state="rescuing"
            status="Rescuing…"
            reserve="••••••"
          />
          <div className="flex flex-col gap-2 rounded-[16px] border border-line bg-panel px-3.5 py-3 text-[13px]">
            <span className="text-muted">Rescue history</span>
            <span className="flex items-center justify-between tabular-nums">
              <span>Oct 28 · +1,486.18 USDC · 38 s</span>
              <span className="font-medium text-green">Saved</span>
            </span>
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4 lg:mt-10 lg:pr-[340px]">
        <p className="text-[13px] text-muted">
          The app&apos;s own screens, in the simulation: example positions and simulated prices.
        </p>
        <Link
          href="/guards?simulation"
          className="inline-flex min-h-11 items-center rounded-full border border-line-3 px-6 text-[15px] font-medium transition-colors duration-[120ms] hover:border-muted"
        >
          Try a simulation
        </Link>
      </div>
    </div>
  );
}
