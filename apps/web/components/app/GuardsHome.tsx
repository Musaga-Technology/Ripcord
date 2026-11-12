'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { guardsFor } from '../../lib/guards';
import { demoSession, SessionProvider, useAccount, useSession } from '../../lib/session';
import { loadGuards, type LocalGuard } from '../../lib/store';
import { Dashboard, type Activity } from '../Dashboard';
import { usd } from '../format';
import { AppShell, ghostBtn, primaryBtn } from './AppShell';
import { Connect } from './Connect';
import { OpenSeal } from './OpenSeal';
import { accountUrl, REGISTRY } from '../../lib/near';
import { Turned, display } from '../Display';

function Home() {
  const { ready, session, enter } = useSession();
  const { account, error } = useAccount(session);
  const [local, setLocal] = useState<LocalGuard[]>([]);
  useEffect(() => setLocal(loadGuards()), [session]);

  if (!ready) return <div className="flex-1" />;
  if (!session) return <Connect />;
  if (error && !account) {
    return (
      <Notice
        title="Hyperliquid can’t be read right now."
        text="Your guards don't depend on this page. It tries again every 15 seconds."
      />
    );
  }
  if (!account) return <Skeleton />;
  if (account.holdings.length === 0) {
    return (
      <Notice
        title="No open positions yet."
        text={`Open one on Hyperliquid and it appears here, ready to guard. This page reads the account every 15 seconds${account.value > 0 ? `; it holds ${usd(account.value, 2)} now` : ''}.`}
      >
        <a href="https://app.hyperliquid.xyz/trade" target="_blank" rel="noreferrer" className={primaryBtn}>
          Open Hyperliquid
        </a>
        <button type="button" className={ghostBtn} onClick={() => enter(demoSession)}>
          Try a simulation
        </button>
      </Notice>
    );
  }

  const isDemo = session.kind === 'demo';
  const guards = guardsFor(session.address, isDemo, local);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Your guards</h1>
      <Dashboard
        holdings={account.holdings}
        guards={guards}
        activity={isDemo ? EXAMPLE_ACTIVITY : []}
        value={account.value}
        rescues={isDemo ? '2 · 1 saved' : '0'}
        demo={isDemo}
      />
      <p className="text-[13px] text-muted">
        {session.kind === 'demo'
          ? 'A simulation: example positions and guards, simulated prices, no wallet and no money. '
          : 'Positions read from Hyperliquid just now, in this browser. '}
        Every guard runs on NEAR: checks in OutLayer&apos;s enclave, reserves in Confidential Intents, and a public
        registry of hashes at{' '}
        <a href={accountUrl(REGISTRY)} className="underline decoration-line-3 underline-offset-4 hover:text-text">
          {REGISTRY}
        </a>
        .
      </p>
      <OpenSeal isDemo={session.kind === 'demo'} onOpened={() => setLocal(loadGuards())} />
    </div>
  );
}

/** The example account's history, newest first. */
const EXAMPLE_ACTIVITY: Activity[] = [
  { when: 'Oct 29', text: 'Saved: ETH passed the old liquidation price', tone: 'green' },
  { when: 'Oct 28', text: 'Rescue landed: +1,486.18 USDC in 38 s', tone: 'green' },
  { when: 'Oct 28', text: 'Close call: +1,373 USDC stayed as margin', tone: 'muted' },
  { when: 'Oct 21', text: 'HYPE guard sealed and funded', tone: 'amber' },
];

function Notice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="my-auto flex flex-col items-center gap-2 py-16 text-center">
      <h1 className={`${display} text-[34px] leading-[1.05] sm:text-[40px]`}>
        <Turned>{title}</Turned>
      </h1>
      <p className="max-w-[30rem] text-text-2">{text}</p>
      {children && <div className="mt-4 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Reading your positions" className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="h-[264px] animate-pulse rounded-[20px] border border-line bg-panel" />
        <div className="hidden h-[264px] animate-pulse rounded-[28px] border border-line bg-panel lg:block" />
      </div>
      <div className="h-[320px] animate-pulse rounded-[20px] border border-line bg-panel" />
    </div>
  );
}

export function GuardsHome() {
  return (
    <SessionProvider>
      <AppShell>
        <Home />
      </AppShell>
    </SessionProvider>
  );
}
