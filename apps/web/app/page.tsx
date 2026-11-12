import Link from 'next/link';
import { rosette } from '@ripcord/shared';
import { ThemeToggle } from '../components/ThemeToggle';
import { HeroLive } from '../components/site/HeroLive';
import { HuntGame } from '../components/site/HuntGame';
import { Levels } from '../components/site/Levels';
import { Reveal } from '../components/site/Reveal';
import { Edge } from '../components/site/Edge';
import { AppPreview } from '../components/site/AppPreview';
import { NearPath } from '../components/site/NearPath';
import { SealMark } from '../components/SealMark';
import { EngravedField } from '../components/site/EngravedField';

// Home (docs/DESIGN.md §4.1): one bold object per section, few words, every public number with its source and date.

const wrap =
  'mx-auto w-full max-w-[1240px] pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-8';
const proof =
  'inline-flex min-h-11 w-fit items-center gap-1.5 text-[14px] font-medium text-text underline decoration-line-3 underline-offset-4 transition-colors duration-[120ms] hover:decoration-text';
const h2 = 'font-display text-[44px] font-normal leading-[1] tracking-[-0.02em] sm:text-[72px]';
/** The one word a headline turns on, in italic amber. */
const turn = 'italic text-amber';
const primary =
  'inline-flex min-h-11 items-center rounded-full bg-text px-6 text-[15px] font-semibold text-ground transition-opacity duration-[120ms] hover:opacity-90 active:opacity-80';
const ghost =
  'inline-flex min-h-11 items-center rounded-full border border-line-3 px-6 text-[15px] font-medium transition-colors duration-[120ms] hover:border-muted';

/** The public repository; every proof link opens the file that backs the claim. */
const REPO = 'https://github.com/Musaga-Technology/Ripcord';
const src = (path: string) => `${REPO}/blob/main/${path}`;

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
    "The wallet's policy",
    src('checker/src/policy.rs#L15'),
  ],
  [
    'Nobody can link it.',
    'Your reserve sits in a confidential balance. When USDC lands, no one can trace it back or see what is left.',
    'The test: no address on chain',
    src('contracts/guard-registry/src/tests.rs#L477'),
  ],
  [
    'A line nobody can learn.',
    'Ripcord picks the rescue point privately inside your range, and changes it after every rescue. Watching rescues teaches a hunter nothing.',
    'The replays',
    src('crates/replay'),
  ],
  [
    'Code you can check.',
    'The guard runs in a sealed enclave built from public source. Every rescue comes with a receipt anyone can verify.',
    'The enclave build',
    src('checker/build.sh'),
  ],
  [
    'Freeze it yourself.',
    'Each reserve has its own wallet, and its rules change only with your signature. One signature freezes it, even if Ripcord disappears.',
    'The freeze, on chain',
    src('contracts/guard-registry/src/lib.rs#L434'),
  ],
  [
    'We pay if we fail.',
    'If a guard misses because of us, our make-good fund pays back what the liquidation took, up to your reserve or $10,000, whichever is lower.',
    'How a claim is decided',
    src('docs/ARCHITECTURE.md'),
  ],
];

const FAQ = [
  [
    'Why not just add margin, or run a bot that does?',
    'Extra margin sits in your account, where anyone can see it and price it in. A hunter knows exactly how far to push. A Ripcord reserve sits off the exchange in a confidential balance, so nobody knows it exists until it lands, and nobody can tell how much is left.',
  ],
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
            <SealMark />
            Ripcord
          </Link>
          <nav aria-label="Site" className="hidden items-center gap-7 text-[15px] text-muted lg:flex">
            <a href="#how" className="hover:text-text">
              How it works
            </a>
            <a href="#pricing" className="hover:text-text">
              Pricing
            </a>
            <a href="#app" className="hover:text-text">
              The app
            </a>
            <a href="#near" className="hover:text-text">
              On NEAR
            </a>
            <a href="#hunt" className="hover:text-text">
              Try to hunt it
            </a>
            <a href={REPO} className="hover:text-text">
              GitHub
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
          className={`${wrap} relative grid items-center gap-14 pb-28 pt-14 sm:pt-20 lg:grid-cols-[1fr_1.12fr] lg:gap-10 lg:pb-36`}
        >
          <EngravedField className="absolute -left-[22%] top-[-330px] -z-10 hidden w-[78%] max-w-[1100px] [mask-image:linear-gradient(to_bottom,black_60%,transparent_74%)] lg:block" />
          <div className="flex flex-col gap-7">
            <h1 className="font-display text-[76px] font-normal leading-[0.9] tracking-[-0.025em] sm:text-[112px] lg:text-[144px]">
              Hidden <span className={turn}>margin.</span>
            </h1>
            <p className="max-w-[30rem] text-[17px] leading-[1.55] text-text-2 sm:text-[20px]">
              Everyone can see where your Hyperliquid position dies. Ripcord keeps a reserve nobody can see, and moves
              it in first.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/guards" className={primary}>
                Guard a position
              </Link>
              <a href="#hunt" className={ghost}>
                Try to hunt it
              </a>
            </div>
            <a href="#near" className="group flex w-fit flex-col gap-1 text-[13px] text-muted">
              <span className="font-medium text-text-2">Runs on NEAR</span>
              <span>
                Sealed by OutLayer · hidden in Confidential Intents · moved by NEAR Intents{' '}
                <span aria-hidden="true" className="transition-transform duration-[120ms] group-hover:translate-x-0.5">
                  →
                </span>
              </span>
            </a>
          </div>
          <HeroLive />
        </section>

        <section id="app" className={`${wrap} scroll-mt-20 py-24`}>
          <div className="flex max-w-[36rem] flex-col gap-5">
            <h2 className={h2}>
              This is the <span className={turn}>app.</span>
            </h2>
            <p className="text-[17px] text-text-2">
              Your positions with their guards, each guard a card only you can open, and the view a hunter gets: the
              same position with nothing to aim at.
            </p>
          </div>
          <div className="mt-12">
            <AppPreview />
          </div>
        </section>

        <section className={`${wrap} grid items-center gap-12 py-24 lg:grid-cols-[1fr_1.1fr]`}>
          <Reveal className="flex flex-col gap-5">
            <h2 className={h2}>
              Your liquidation price is <span className={turn}>public.</span>
            </h2>
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

        <section id="near" className={`${wrap} scroll-mt-20 py-24`}>
          <NearPath />
        </section>

        <section className={`${wrap} py-24`}>
          <Edge />
        </section>

        <section id="how" className={`${wrap} scroll-mt-20 py-24`}>
          <Reveal>
            <h2 className={h2}>
              Three steps. Then it <span className={turn}>watches.</span>
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map(([title, body], i) => (
              <Reveal key={title} className="flex flex-col gap-3 border-t border-line pt-6">
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line-3 px-3 py-1 text-[13px] font-medium">
                  <span
                    className={`h-[7px] w-[7px] rounded-full ${i === 2 ? 'bg-amber' : 'bg-muted'} ${i === 0 ? 'chip-pulse' : ''}`}
                  />
                  {['Sealing…', 'Waiting for reserve', 'Guarded'][i]}
                </span>
                <h3 className="text-[28px] font-semibold tracking-[-0.03em]">{title}</h3>
                <p className="text-[15px] text-text-2">{body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="hunt" className={`${wrap} scroll-mt-20 py-24`}>
          <Reveal className="flex max-w-[36rem] flex-col gap-5">
            <h2 className={h2}>
              Try to <span className={turn}>hunt</span> it.
            </h2>
            <p className="text-[17px] text-text-2">
              You can see where this position dies. Sell into the book and push the price there. The guard runs the same
              rules as the real one.
            </p>
          </Reveal>
          <div className="mt-12">
            <HuntGame />
          </div>
        </section>

        <section className={`${wrap} py-24`}>
          <Reveal className="flex max-w-[44rem] flex-col gap-5">
            <h2 className={h2}>
              It held through a <span className={turn}>real</span> crash.
            </h2>
            <p className="text-[17px] text-text-2">
              October 10, 2025, replayed on real one-minute prices: a BTC 10× long opened every 10 minutes from noon to
              20:40 UTC and held for a day, each with a hidden reserve the size of its margin.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {[
              ['53', 'text-red', 'Liquidated without a guard'],
              ['0', 'text-amber', 'Liquidated with Ripcord'],
            ].map(([n, tone, label]) => (
              <Reveal key={label} className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-7">
                <span className={`font-display text-[96px] leading-none tracking-[-0.02em] sm:text-[128px] ${tone}`}>
                  {n}
                  <span className="text-muted">/53</span>
                </span>
                <span className="text-[17px] font-semibold">{label}</span>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8 flex max-w-[44rem] flex-col gap-3">
            <p className="text-[15px] text-text-2">
              On a month of prices it had never seen, with its predictions sealed before the run, the guard cut
              liquidations by 96%.
            </p>
            <div className="flex flex-wrap gap-x-6">
              <a href={src('crates/replay/tests/crash.rs')} className={proof}>
                The crash replay
                <span aria-hidden="true">↗</span>
              </a>
              <a href={src('crates/replay/holdout/predictions.md')} className={proof}>
                The sealed predictions
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </Reveal>
        </section>

        <section id="pricing" className={`${wrap} scroll-mt-20 py-24`}>
          <Reveal className="flex max-w-[44rem] flex-col gap-5">
            <h2 className={h2}>
              Pay for <span className={turn}>saves,</span> not alarms.
            </h2>
            <p className="text-[17px] text-text-2">
              Most rescues end with the price bouncing. Those cost you nothing but the network fee, and the USDC stays
              yours. The only other charge is $1 a month for the checks.
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
                <span className="font-display text-[72px] leading-none tracking-[-0.02em]">{n}</span>
                <span className="text-[17px] font-semibold">{t}</span>
                <span className="text-[15px] text-text-2">{b}</span>
              </Reveal>
            ))}
          </div>
        </section>

        <section className={`${wrap} py-24`}>
          <Reveal>
            <h2 className={h2}>
              Built so you don’t have to <span className={turn}>trust</span> us.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map(([t, b, label, href]) => (
              <Reveal key={t} className="flex flex-col gap-2 border-t border-line pt-6">
                <h3 className="text-[20px] font-semibold tracking-[-0.02em]">{t}</h3>
                <p className="text-[15px] text-text-2">{b}</p>
                <a href={href} className={proof}>
                  {label}
                  <span aria-hidden="true">↗</span>
                </a>
              </Reveal>
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
                <p className="mt-3 max-w-[32rem] text-[15px] text-text-2">{a}</p>
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
              <h2 className={h2}>
                Your line is public. Your defence <span className={turn}>isn’t.</span>
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
        <div className={`${wrap} grid gap-10 py-12 text-[15px] sm:grid-cols-[1.4fr_1fr_1fr]`}>
          <div className="flex flex-col gap-3">
            <span className="flex items-center gap-2 font-semibold">
              <SealMark /> Ripcord
            </span>
            <span className="max-w-[22rem] text-[13px] text-muted">
              Hidden margin for Hyperliquid. Built at NEAR HACKATHON, 2026.
            </span>
          </div>
          <nav aria-label="Product" className="flex flex-col gap-1 text-text-2">
            <span className="pb-1 text-[13px] text-muted">Product</span>
            <Link href="/guards" className="min-h-9 hover:text-text">
              Guard a position
            </Link>
            <Link href="/guards?simulation" className="min-h-9 hover:text-text">
              Try a simulation
            </Link>
            <a href="#hunt" className="min-h-9 hover:text-text">
              Try to hunt it
            </a>
          </nav>
          <nav aria-label="Proof" className="flex flex-col gap-1 text-text-2">
            <span className="pb-1 text-[13px] text-muted">Proof</span>
            <a href={REPO} className="min-h-9 hover:text-text">
              Source code
            </a>
            <a href={src('docs/EVIDENCE.md')} className="min-h-9 hover:text-text">
              Evidence for every claim
            </a>
            <a href={src('docs/ARCHITECTURE.md')} className="min-h-9 hover:text-text">
              How it works, in full
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
