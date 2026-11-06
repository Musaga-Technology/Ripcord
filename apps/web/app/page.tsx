import Link from 'next/link';
import { rosette } from '@ripcord/shared';
import { ThemeToggle } from '../components/ThemeToggle';
import { HeroLive } from '../components/site/HeroLive';
import { HuntGame } from '../components/site/HuntGame';
import { Levels } from '../components/site/Levels';
import { Count, Reveal } from '../components/site/Reveal';
import { WatchLine } from '../components/site/WatchLine';
import { Edge } from '../components/site/Edge';

// Home (docs/DESIGN.md §4.1): one bold object per section, few words, every public number with its source and date.

function Logo() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="9.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11" cy="11" r="5.5" stroke="var(--amber)" strokeWidth="1.4" />
    </svg>
  );
}

const wrap =
  'mx-auto w-full max-w-[1240px] pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-8';
const h2 = 'text-[36px] font-semibold leading-[1] tracking-[-0.045em] sm:text-[56px]';
const primary =
  'inline-flex min-h-11 items-center rounded-full bg-text px-6 text-[15px] font-semibold text-ground transition-opacity duration-[120ms] hover:opacity-90 active:opacity-80';
const ghost =
  'inline-flex min-h-11 items-center rounded-full border border-line-3 px-6 text-[15px] font-medium transition-colors duration-[120ms] hover:border-muted';

const STATS: { to?: number; prefix?: string; suffix?: string; text?: string; src: string }[] = [
  {
    text: '27–46 s',
    src: 'Mainnet test rescues from a hidden reserve into Hyperliquid margin, Oct 21.',
  },
  { text: '0 of 53', src: 'BTC 10× longs liquidated in a replay of the Oct 10, 2025 crash. 53 of 53 without Ripcord.' },
  { to: 35, suffix: '+', src: 'Chains your reserve can come from, through NEAR Intents.' },
  { text: '$0', src: "Ripcord's fee when a rescue doesn't save you. 3% of it when it does." },
];

const STEPS = [
  [
    'Seal',
    'Say when to step in: "rescue me 5–8% from liquidation." Your settings are encrypted to the guard. Only a fingerprint is public.',
  ],
  [
    'Fund',
    'Keep a reserve in BTC, ETH, SOL, NEAR or USDC, sent from its own chain. It sits in a confidential balance, so its size stays private.',
  ],
  [
    'Guarded',
    'Near liquidation, Ripcord lands part of the reserve in your Hyperliquid margin as USDC in under a minute. An isolated position takes one approval on Hyperliquid first.',
  ],
];

const TRUST = [
  [
    'Pays only you.',
    'A rescue can only send USDC to your own Hyperliquid account. The worst a false alarm can do is add to your margin.',
  ],
  [
    'Nobody can link it.',
    'Your reserve sits in a confidential balance. When USDC lands, no one can trace it back or see what is left.',
  ],
  [
    'A line nobody can learn.',
    'Ripcord picks the rescue point privately inside your range, and changes it after every rescue. Watching rescues teaches a hunter nothing.',
  ],
  [
    'Code you can check.',
    'The guard runs in a sealed enclave built from public source. Every rescue comes with a receipt anyone can verify.',
  ],
  [
    'Freeze it yourself.',
    'Each reserve has its own wallet, and its rules change only with your signature. One signature freezes it, even if Ripcord disappears.',
  ],
  [
    'We pay if we fail.',
    'If a guard misses because of us, our make-good fund pays back what the liquidation took, up to your reserve or $10,000, whichever is lower.',
  ],
];

const NEAR = [
  ['NEAR Intents', 'Turns a reserve on 35+ chains into Hyperliquid margin.'],
  ['Confidential Intents', 'Keeps the reserve private and every rescue unlinkable.'],
  ['OutLayer', 'Runs the guard in a sealed enclave and gives each reserve its own custody wallet.'],
  ['NEAR contract', 'Holds each guard as hashes, and its wallet rules, which only your signature changes.'],
  ['NEAR AI Cloud', 'Coming next: reads your plain-English setup privately.'],
];

const FAQ = [
  [
    'Does Ripcord hold my funds?',
    "Only the reserve you fund, in a wallet of its own. That wallet can pay just three places: your Hyperliquid account, an address you sign for, and Ripcord's fee after a save. For an isolated position you also approve the guard on Hyperliquid; its published code only adds margin, and Hyperliquid blocks it from withdrawing.",
  ],
  [
    'Can anyone see my rescue range or reserve?',
    "No. Your settings are encrypted on your device to the guard's sealed enclave; the public sees a fingerprint. The reserve sits in a confidential balance, and a rescue arrives on Hyperliquid with no link back to it.",
  ],
  [
    'What if the market moves faster than a rescue?',
    'A rescue takes under a minute. A move faster than that can still liquidate you. When the price falls fast, the guard steps in earlier and adds more. If a guard misses because of us, the make-good fund pays.',
  ],
  [
    'What happens to the USDC if the price bounces?',
    'It stays in your Hyperliquid margin, yours. That is a close call: no Ripcord fee, only the network cost of about $0.32.',
  ],
  [
    'Which positions can it guard?',
    'Hyperliquid perpetuals, cross or isolated. An isolated position takes one approval on Hyperliquid so a rescue can reach it.',
  ],
];

export default function Home() {
  const band = rosette('3c9a51e07f2b48d6a1c5e93f0b7d2a84c6e1f5a9b3d7c0e2f4a6b8c1d3e5f7a9');
  return (
    <div className="min-h-screen overflow-x-clip">
      <header className="sticky top-0 z-40 border-b border-line bg-ground">
        <div className={`${wrap} flex h-16 items-center justify-between gap-6`}>
          <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
            <Logo />
            Ripcord
          </Link>
          <nav aria-label="Site" className="hidden items-center gap-7 text-[15px] text-muted md:flex">
            <a href="#how" className="hover:text-text">
              How it works
            </a>
            <a href="#pricing" className="hover:text-text">
              Pricing
            </a>
            <a href="#hunt" className="hover:text-text">
              Try to hunt it
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/guards" className={`${primary} min-h-10 whitespace-nowrap px-5 text-[14px]`}>
              Launch app
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section
          className={`${wrap} grid items-center gap-14 pb-28 pt-14 sm:pt-20 lg:grid-cols-[1fr_1.12fr] lg:gap-10 lg:pb-36`}
        >
          <div className="flex flex-col gap-7">
            <h1 className="text-[60px] font-semibold leading-[0.95] tracking-[-0.05em] sm:text-[88px] lg:text-[112px]">
              Hidden margin.
            </h1>
            <p className="max-w-[30rem] text-[17px] leading-[1.55] text-text-2 sm:text-[20px]">
              Everyone can see where your Hyperliquid position dies. Ripcord keeps a reserve nobody can see, and moves
              it in first.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/guards" className={primary}>
                Guard a position
              </Link>
              <a href="#rescue" className={ghost}>
                Watch a rescue
              </a>
            </div>
          </div>
          <HeroLive />
        </section>

        <section className={`${wrap} grid grid-cols-2 gap-x-6 gap-y-10 border-t border-line py-16 lg:grid-cols-4`}>
          {STATS.map((s) => (
            <Reveal key={s.src} className="flex flex-col gap-2">
              <span className="text-[36px] font-semibold leading-none tracking-[-0.04em] sm:text-[48px]">
                {s.to !== undefined ? <Count to={s.to} prefix={s.prefix ?? ''} suffix={s.suffix ?? ''} /> : s.text}
              </span>
              <span className="max-w-[17rem] text-[13px] leading-[1.5] text-muted">{s.src}</span>
            </Reveal>
          ))}
        </section>

        <section className={`${wrap} grid items-center gap-12 py-24 lg:grid-cols-[1fr_1.1fr]`}>
          <Reveal className="flex flex-col gap-5">
            <h2 className={h2}>Your liquidation price is public.</h2>
            <p className="max-w-[32rem] text-[17px] text-text-2">
              Hyperliquid puts every position on chain. Heatmap tools draw every trader&apos;s liquidation level in real
              time, and some traders push price straight into them.
            </p>
            <p className="max-w-[32rem] text-[17px] text-text-2">
              The usual defence is extra margin, which hunters can see too. Ripcord&apos;s defence is invisible until it
              lands.
            </p>
          </Reveal>
          <Levels />
        </section>

        <section className={`${wrap} py-24`}>
          <Edge />
        </section>

        <section id="how" className={`${wrap} scroll-mt-20 py-24`}>
          <Reveal>
            <h2 className={h2}>Three steps. Then it watches.</h2>
          </Reveal>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map(([title, body], i) => (
              <Reveal key={title} className="flex flex-col gap-3 border-t border-line pt-6">
                <span className="font-mono text-[13px] text-muted">0{i + 1}</span>
                <h3 className="text-[28px] font-semibold tracking-[-0.03em]">{title}</h3>
                <p className="text-[15px] text-text-2">{body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="rescue" className={`${wrap} scroll-mt-20 py-24`}>
          <Reveal className="flex max-w-[36rem] flex-col gap-5">
            <h2 className={h2}>Watch the line move.</h2>
            <p className="text-[17px] text-text-2">
              A wick to 2,205 would have liquidated this ETH long at 2,231. Two hidden rescues moved the line out of
              reach, then price came back. Only the first was a save, so it&apos;s the only one Ripcord charges for.
            </p>
          </Reveal>
          <div className="mt-12">
            <WatchLine />
          </div>
        </section>

        <section id="hunt" className={`${wrap} scroll-mt-20 py-24`}>
          <Reveal className="flex max-w-[36rem] flex-col gap-5">
            <h2 className={h2}>Try to hunt it.</h2>
            <p className="text-[17px] text-text-2">
              You can see where this position dies. Sell into the book and push the price there. The guard runs the same
              rules as the real one.
            </p>
          </Reveal>
          <div className="mt-12">
            <HuntGame />
          </div>
        </section>

        <section id="pricing" className={`${wrap} scroll-mt-20 py-24`}>
          <Reveal className="flex max-w-[44rem] flex-col gap-5">
            <h2 className={h2}>Paid only when it saves you.</h2>
            <p className="text-[17px] text-text-2">
              Most rescues end with the price bouncing. Those cost you nothing but the network fee, and the USDC stays
              yours.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              [
                '$0',
                'Close call',
                'The price bounced before your old liquidation price. The USDC stays in your margin. You pay only the network fee, about $0.32.',
              ],
              [
                '3%',
                'Save',
                'The price crossed your old liquidation price within 24 hours, so the rescue kept you in. 3% of that rescue, 0.5% on any part above $50,000, with a public receipt.',
              ],
              ['$1', 'A month, per guard', 'Pays for the enclave checks that watch your position, day and night.'],
            ].map(([n, t, b]) => (
              <Reveal key={t} className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-7">
                <span className="text-[56px] font-semibold leading-none tracking-[-0.05em]">{n}</span>
                <span className="text-[17px] font-semibold">{t}</span>
                <span className="text-[15px] text-text-2">{b}</span>
              </Reveal>
            ))}
          </div>
        </section>

        <section className={`${wrap} py-24`}>
          <Reveal>
            <h2 className={h2}>Built so you don&apos;t have to trust us.</h2>
          </Reveal>
          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map(([t, b]) => (
              <Reveal key={t} className="flex flex-col gap-2 border-t border-line pt-6">
                <h3 className="text-[20px] font-semibold tracking-[-0.02em]">{t}</h3>
                <p className="text-[15px] text-text-2">{b}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className={`${wrap} py-24`}>
          <Reveal>
            <h2 className={h2}>Built on NEAR.</h2>
          </Reveal>
          <div className="mt-12 grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
            {NEAR.map(([t, b]) => (
              <div key={t} className="flex flex-col gap-2 bg-ground p-6">
                <span className="text-[17px] font-semibold">{t}</span>
                <span className="text-[15px] text-text-2">{b}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={`${wrap} py-24`}>
          <Reveal>
            <h2 className={h2}>Questions.</h2>
          </Reveal>
          <div className="mt-10 max-w-[52rem] divide-y divide-line border-y border-line">
            {FAQ.map(([q, a], i) => (
              <details key={q} className="faq group py-5" open={i === 0}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-semibold">
                  {q}
                  <span
                    aria-hidden="true"
                    className="text-[22px] font-normal text-muted transition-transform duration-[240ms] group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-[36rem] text-[15px] text-text-2">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`${wrap} pb-24`}>
          <div
            className="card-dark relative overflow-hidden rounded-[28px] border px-8 py-16 sm:px-14 sm:py-24"
            style={{ background: 'var(--card)', borderColor: 'var(--card-line)', color: 'var(--card-text)' }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 600 378"
              preserveAspectRatio="xMaxYMid slice"
              className="absolute inset-0 h-full w-full"
            >
              <path
                d={band.outer}
                fill="none"
                stroke="var(--card-rosette)"
                strokeWidth={0.7}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={band.inner}
                fill="none"
                stroke="var(--card-amber)"
                strokeWidth={0.6}
                opacity={0.5}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="relative flex max-w-[40rem] flex-col items-start gap-8">
              <h2 className="text-[40px] font-semibold leading-[1] tracking-[-0.045em] sm:text-[64px]">
                Your line is public. Your defence isn&apos;t.
              </h2>
              <Link
                href="/guards"
                className="inline-flex min-h-11 items-center rounded-full px-6 text-[15px] font-semibold"
                style={{ background: 'var(--card-text)', color: 'var(--card)' }}
              >
                Guard a position
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-8 text-[13px] text-muted`}>
          <span className="flex items-center gap-2 text-text">
            <Logo /> Ripcord
          </span>
          <span>Built at NEAR HACKATHON, 2026</span>
        </div>
      </footer>
    </div>
  );
}
