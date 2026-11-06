'use client';

import { useEffect, useState } from 'react';
import { guardOf, guardsFor } from '../../lib/guards';
import { SessionProvider, useAccount, useSession } from '../../lib/session';
import { loadGuards, type LocalGuard } from '../../lib/store';
import { Dashboard } from '../Dashboard';
import { usd } from '../format';
import { AppShell } from './AppShell';
import { Connect } from './Connect';
import { OpenSeal } from './OpenSeal';

function Home() {
  const { ready, session } = useSession();
  const { account, error } = useAccount(session);
  const [local, setLocal] = useState<LocalGuard[]>([]);
  useEffect(() => setLocal(loadGuards()), [session]);

  if (!ready) return <div className="flex-1" />;
  if (!session) return <Connect />;
  if (error && !account) {
    return (
      <Notice
        title="Hyperliquid can't be read right now."
        text="Your guards don't depend on this page. It tries again every 15 seconds."
      />
    );
  }
  if (!account) return <Skeleton />;
  if (account.holdings.length === 0) {
    return (
      <Notice
        title="No open positions on this account."
        text="When this account holds a position, it shows here, ready to guard."
      />
    );
  }

  const guards = guardsFor(session.address, session.kind === 'demo', local);
  const guarded = account.holdings.filter((h) => guardOf(h, guards)?.state === 'guarded');
  const notional = guarded.reduce((s, h) => s + h.notional, 0);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Your guards</h1>
      <section
        aria-label="Summary"
        className="grid grid-cols-2 overflow-hidden rounded-[20px] border border-line bg-panel md:grid-cols-3"
      >
        <Stat label="Account value" value={usd(account.value, 2)} />
        <Stat label="Guarded notional" value={usd(notional)} note={`${guarded.length} of ${account.holdings.length}`} />
        <ReserveStat reserves={guards.flatMap((g) => (g.example ? [g.example.reserve] : []))} />
      </section>
      <Dashboard holdings={account.holdings} guards={guards} />
      {session.kind === 'demo' ? (
        <p className="text-[13px] text-muted">
          An example account and example guards. No wallet is connected and no funds move.
        </p>
      ) : (
        <p className="text-[13px] text-muted">Read from Hyperliquid just now, in this browser.</p>
      )}
      <OpenSeal isDemo={session.kind === 'demo'} onOpened={() => setLocal(loadGuards())} />
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="my-auto flex flex-col items-center gap-2 py-16 text-center">
      <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="max-w-[28rem] text-text-2">{text}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Reading your positions" className="flex flex-col gap-6">
      <div className="h-[84px] animate-pulse rounded-[20px] border border-line bg-panel" />
      <div className="h-[320px] animate-pulse rounded-[20px] border border-line bg-panel" />
    </div>
  );
}

/** The owner's own reserves, masked until held: the dashboard is the owner's view, so it may show them. */
function ReserveStat({ reserves }: { reserves: string[] }) {
  const [peek, setPeek] = useState(false);
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 [&:not(:first-child)]:md:border-l">
      <span className="flex items-center justify-between gap-3 text-[13px] text-muted">
        Reserve
        {reserves.length > 0 && (
          <button
            type="button"
            className="min-h-9 select-none rounded-full border border-line-3 px-3 text-[13px] font-medium text-text"
            onPointerDown={() => setPeek(true)}
            onPointerUp={() => setPeek(false)}
            onPointerLeave={() => setPeek(false)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setPeek(true)}
            onKeyUp={() => setPeek(false)}
          >
            Hold to peek
          </button>
        )}
      </span>
      <span
        className={`text-[20px] font-semibold tracking-[-0.02em] tabular-nums ${peek ? '' : 'font-mono tracking-[0.2em]'}`}
      >
        {peek ? reserves.join(' · ') : '••••••'}
      </span>
    </div>
  );
}

function Stat({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 [&:not(:first-child)]:md:border-l">
      <span className="text-[13px] text-muted">{label}</span>
      <span
        className={`text-[20px] font-semibold tracking-[-0.02em] tabular-nums ${mono ? 'font-mono tracking-[0.2em]' : ''}`}
      >
        {value} {note ? <span className="text-[13px] font-medium tracking-normal text-muted">{note}</span> : null}
      </span>
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
