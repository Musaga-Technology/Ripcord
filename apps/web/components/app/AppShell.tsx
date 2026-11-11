'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '../../lib/session';
import { ThemeToggle } from '../ThemeToggle';
import { AccountMenu } from './AccountMenu';

function Logo() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="9.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11" cy="11" r="5.5" stroke="var(--amber)" strokeWidth="1.4" />
    </svg>
  );
}

const TABS = [
  { href: '/guards', label: 'Guards' },
  { href: '/ledger', label: 'Ledger' },
  { href: '/verify', label: 'Verify' },
] as const;

function Tabs({ phone }: { phone?: boolean }) {
  const path = usePathname() ?? '';
  return TABS.map((t) => {
    const here = path === t.href || path.startsWith(`${t.href}/`);
    return (
      <Link
        key={t.href}
        href={t.href}
        aria-current={here ? 'page' : undefined}
        className={
          phone
            ? `flex min-h-12 flex-1 items-center justify-center text-[15px] ${here ? 'font-semibold text-text' : 'text-muted'}`
            : `rounded-full px-3 py-2 transition-colors duration-[120ms] ${here ? 'bg-line' : 'text-text-2 hover:text-text'}`
        }
      >
        {t.label}
      </Link>
    );
  });
}

export const appWrap =
  'mx-auto w-full max-w-[1360px] pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-8';

export function AppShell({ children }: { children: ReactNode }) {
  const { session, leave } = useSession();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className={`${appWrap} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3`}>
          <div className="flex items-center gap-4 sm:gap-9">
            <Link href="/" className="flex min-h-10 items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
              <Logo />
              Ripcord
            </Link>
            <nav aria-label="App" className="hidden gap-1 text-[15px] sm:flex">
              <Tabs />
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {session?.kind === 'demo' && (
              <span className="hidden text-[13px] text-muted sm:inline">Example account</span>
            )}
            {session && <AccountMenu session={session} onLeave={leave} />}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={`${appWrap} flex flex-1 flex-col pb-24 pt-7 sm:pb-7`}>{children}</main>
      {/* Phone: the tab bar (DESIGN §3), above the home indicator. */}
      <nav
        aria-label="App"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-ground/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur sm:hidden"
      >
        <Tabs phone />
      </nav>
    </div>
  );
}

export const primaryBtn =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-text px-6 text-[15px] font-semibold text-ground transition-opacity duration-[120ms] hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40';
export const ghostBtn =
  'inline-flex min-h-11 items-center justify-center rounded-full border border-line-3 px-6 text-[15px] font-medium transition-colors duration-[120ms] hover:border-muted disabled:cursor-not-allowed disabled:opacity-40';
export const fieldCls =
  'min-h-11 w-full rounded-[12px] border border-line-3 bg-ground px-3.5 text-[15px] tabular-nums placeholder:text-muted focus:border-muted focus:outline-none';
