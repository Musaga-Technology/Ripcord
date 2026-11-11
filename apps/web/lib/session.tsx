'use client';

// Who the app is looking at: the simulation, an address someone pasted, or a connected wallet. Remembered for this tab
// only and never sent anywhere; positions are read straight from Hyperliquid.
import { DEMO_LEVERAGE, DEMO_POSITIONS, DEMO_TRADER } from '@ripcord/shared/mock';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { demo, live, type Backend } from './backend';
import { readAccount, type Account, type Holding } from './hl';
import { clearSimulation } from './store';

export type SessionKind = 'demo' | 'address' | 'wallet';
export interface Session {
  kind: SessionKind;
  address: string;
}

const KEY = 'ripcord-session';

interface Ctx {
  ready: boolean;
  session: Session | null;
  enter(s: Session): void;
  leave(): void;
}

const SessionContext = createContext<Ctx>({ ready: false, session: null, enter: () => {}, leave: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      // `?simulation` (or the older `?example`) starts a fresh simulation, as the landing page's links do.
      const q = new URLSearchParams(location.search);
      if (q.has('simulation') || q.has('example')) {
        clearSimulation();
        sessionStorage.setItem(KEY, JSON.stringify(demoSession));
      }
      const saved = sessionStorage.getItem(KEY);
      if (saved) setSession(JSON.parse(saved) as Session);
    } catch {
      // A session that isn't remembered still works.
    }
    setReady(true);
  }, []);
  const enter = useCallback((s: Session) => {
    // Every simulation starts from the same example account.
    if (s.kind === 'demo') clearSimulation();
    setSession(s);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // As above.
    }
  }, []);
  const leave = useCallback(() => {
    setSession(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // As above.
    }
  }, []);
  return <SessionContext.Provider value={{ ready, session, enter, leave }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
export const backendFor = (s: Session | null): Backend => (s?.kind === 'demo' ? demo() : live);
export const demoSession: Session = { kind: 'demo', address: DEMO_TRADER };

export function demoAccount(): Account {
  const holdings = DEMO_POSITIONS.map((p): Holding => {
    const leverage = DEMO_LEVERAGE[p.coin] ?? 1;
    const size = Math.abs(p.szi);
    const mark = p.position_value / size;
    return {
      coin: p.coin,
      szi: p.szi,
      size,
      side: p.szi > 0 ? 'Long' : 'Short',
      mark,
      entry: mark,
      liquidation: p.liquidation_px,
      distance: p.liquidation_px === null ? null : (Math.abs(p.liquidation_px - mark) / mark) * 100,
      leverage,
      margin: p.leverage_type,
      marginUsed: p.position_value / leverage,
      maxLeverage: 25,
      notional: p.position_value,
    };
  });
  return { value: 28_410.55, holdings };
}

/** The session's account, refreshed every 15 s. `error` is true while Hyperliquid can't be read. */
export function useAccount(session: Session | null) {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!session) return;
    if (session.kind === 'demo') {
      setAccount(demoAccount());
      return;
    }
    let stop = false;
    const read = () =>
      readAccount(session.address)
        .then((a) => {
          if (stop) return;
          setAccount(a);
          setError(false);
        })
        .catch(() => !stop && setError(true));
    void read();
    const t = setInterval(read, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [session]);
  return { account, error };
}
