'use client';

import { useEffect, useRef, useState } from 'react';
import { accountUrl, CHECKER_HASH, codeUrl, FREEZE_TX_URL, REGISTER_TX_URL, REGISTRY, short } from '../../lib/near';

// "How NEAR keeps it hidden.": the path a guard takes, from your device to your margin, each step the NEAR piece that
// does it, what it hides or moves, and a link that proves it (the code, or a transaction on NEAR). When the path
// scrolls into view, a rescue travels down it once, the way a real one does.

interface Step {
  piece: string;
  title: string;
  body: string;
  proof: { label: string; href: string }[];
}

const STEPS: Step[] = [
  {
    piece: 'NEAR AI Cloud',
    title: 'You say what you want.',
    body: '"Keep my SOL long alive through a 25% drop." Your words are encrypted on your device to a model in an enclave, so Ripcord passes them on without being able to read them. The model fills in the form; the amounts are worked out by code you can read.',
    proof: [
      { label: 'The encrypted request', href: codeUrl('apps/web/lib/copilot.ts') },
      { label: '64 of 64 in the eval', href: codeUrl('scripts/copilot-eval.ts') },
    ],
  },
  {
    piece: 'OutLayer, on NEAR',
    title: 'Your line is sealed.',
    body: 'Your rescue range is encrypted on your device to a sealed enclave on OutLayer. The guard reads Hyperliquid and decides inside it. Nobody can read your line, Ripcord included.',
    proof: [
      { label: 'The enclave code', href: codeUrl('checker/src/check.rs') },
      { label: `Build ${short(CHECKER_HASH)}`, href: codeUrl('checker/build.sh') },
    ],
  },
  {
    piece: 'NEAR Confidential Intents',
    title: 'Your reserve is invisible.',
    body: "It sits in a confidential balance held by the guard's own wallet. Nobody sees its size, and a rescue can't be traced back to it. The wallet can pay only your Hyperliquid account.",
    proof: [
      { label: 'The wallet and its rules', href: codeUrl('checker/src/policy.rs') },
      { label: 'The private withdraw', href: codeUrl('checker/src/custody.rs') },
    ],
  },
  {
    piece: 'NEAR Intents',
    title: 'Your rescue lands in under a minute.',
    body: 'Fund it in BTC, ETH, SOL, NEAR or USDC from its own chain. Near liquidation, part of it becomes USDC in your Hyperliquid margin in one private step: 27\u2060–\u206046\u00a0s in mainnet tests.',
    proof: [{ label: 'The rescue, step by step', href: codeUrl('checker/src/check.rs') }],
  },
  {
    piece: 'A NEAR contract',
    title: 'Your rules are on chain.',
    body: "A public registry holds each guard as hashes, never an address. It controls the reserve wallet's rules, so only your signature can freeze it, even if Ripcord disappears.",
    proof: [
      { label: 'The registry', href: accountUrl(REGISTRY) },
      { label: 'A guard registered on testnet', href: REGISTER_TX_URL },
      { label: 'A reserve frozen on testnet', href: FREEZE_TX_URL },
    ],
  },
];

export function NearPath() {
  const box = useRef<HTMLOListElement>(null);
  const [run, setRun] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        setRun(true);
      },
      { rootMargin: '0px 0px -30% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
      <div className="flex flex-col gap-5 lg:sticky lg:top-28 lg:self-start">
        <h2 className="font-display text-[44px] font-normal leading-[1] tracking-[-0.02em] sm:text-[72px]">
          How NEAR keeps it <span className="italic text-amber">hidden.</span>
        </h2>
        <p className="max-w-[30rem] text-[17px] text-text-2">
          Every part that has to stay private, and every part that has to move fast, runs on NEAR. Each step links the
          code or the transaction that proves it.
        </p>
        <p className="text-[13px] text-muted">
          Live on NEAR mainnet: the registry at {REGISTRY} and the enclave build {short(CHECKER_HASH)}.
        </p>
      </div>
      <ol ref={box} className={`near-path relative flex flex-col ${run ? 'run' : ''}`}>
        <span aria-hidden="true" className="absolute bottom-6 left-[11px] top-6 w-px bg-line-3" />
        <span
          aria-hidden="true"
          className="near-pulse absolute left-[7px] top-6 h-[9px] w-[9px] rounded-full bg-amber"
        />
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex gap-6 pb-10 last:pb-0">
            <span
              aria-hidden="true"
              className="relative z-10 mt-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-3 bg-ground text-[12px] tabular-nums text-text-2"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-[13px] font-medium text-amber">{s.piece}</span>
              <h3 className="text-[24px] font-semibold leading-tight tracking-[-0.03em]">{s.title}</h3>
              <p className="max-w-[34rem] text-[15px] text-text-2">{s.body}</p>
              <span className="flex flex-wrap gap-x-5">
                {s.proof.map((p) => (
                  <a
                    key={p.label}
                    href={p.href}
                    className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium underline decoration-line-3 underline-offset-4 hover:decoration-text"
                  >
                    {p.label}
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </span>
            </div>
          </li>
        ))}
        <li className="relative flex gap-6">
          <span
            aria-hidden="true"
            className="relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-green text-ground"
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 5.2 4.1 7.3 8 2.8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="pt-1 text-[17px] font-semibold">USDC in your Hyperliquid margin. Your position lives.</span>
        </li>
      </ol>
    </div>
  );
}
