'use client';

// Guard (docs/DESIGN.md §4.3): what a hunter sees beside the card and its sealed settings, the health line, and the
// rescue history. An example guard can be run through a simulated crash; a real one reads Hyperliquid and the registry.
import { DEMO_GUARDS } from '@ripcord/shared/mock';
import { open, readSealFile, type GuardSettings, type SealContents } from '@ripcord/shared';
import { hexToBytes } from '@noble/hashes/utils.js';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { lastCheck, readGuard, readReceipts, type OnChainReceipt } from '../../lib/backend';
import { CrashRun, marginFor } from '../../lib/crash';
import { guardOf, guardsFor, STATE_TEXT, stateOf, type ShownGuard } from '../../lib/guards';
import { readCandles, readMark, type Holding } from '../../lib/hl';
import { distance as distanceOf } from '../../lib/sim';
import { backendFor, SessionProvider, useAccount, useSession } from '../../lib/session';
import { downloadSealFile, keepOpened, loadGuards, openedSeal, patchGuard, type LocalGuard } from '../../lib/store';
import { pct, price, usd } from '../format';
import { GuardCard, type CardState } from '../GuardCard';
import { rangeOf, RescueChart } from '../RescueChart';
import { Ticker } from '../Ticker';
import { Card3D } from '../site/Card3D';
import { AppShell, fieldCls, ghostBtn, primaryBtn } from './AppShell';
import { Connect } from './Connect';
import { Approve, assetOf, Fund } from './steps';

const DOTS = '••••••';
/** Calm stretches of a crash run at 10× speed; the rescue in flight at 3×, so its clock can be read. */
const CALM_SPEED = 10;
const FLIGHT_SPEED = 3;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
/** An hour's heartbeat, twice over: past this the guard isn't being checked (docs/SPEC.md §4). */
const PAUSED_AFTER_MS = 2 * 3_600_000;

const clockOf = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

interface HistoryRow {
  when: string;
  added: string;
  landedIn: string;
  outcome: 'Saved' | 'Settling' | 'Close call' | 'Liquidated';
}

const OUTCOME: Record<string, HistoryRow['outcome']> = {
  pending: 'Settling',
  saved: 'Saved',
  early: 'Close call',
  failed: 'Liquidated',
};

/** A guard's sealed settings once its seal file is open, or the example's. */
function exampleSettings(id: string): GuardSettings | null {
  return DEMO_GUARDS.find((g) => g.guardId === id)?.settings ?? null;
}

function useCrash(h: Holding, settings: GuardSettings | null, reserveX: number) {
  const run = useRef<CrashRun | null>(null);
  const [, tick] = useState(0);
  const [seed, setSeed] = useState(7);
  const spec = useMemo(() => {
    const side = h.szi > 0 ? (1 as const) : (-1 as const);
    const mm = 1 / (2 * h.maxLeverage);
    const margin = marginFor(side, h.mark, h.notional, mm, h.liquidation ?? h.mark * (1 - side * 0.2));
    return {
      pos: { side, entry: h.mark, notional: h.notional, leverage: h.leverage, mm, margin },
      guard: {
        lineRange: settings?.line_range_pct ?? ([5, 8] as [number, number]),
        targetRange: settings?.target_range_pct ?? ([9, 13] as [number, number]),
        speedAware: true,
        reserveX: reserveX > 0 ? reserveX * (h.notional / h.leverage / margin) : 1,
        landS: 38,
        cooldownS: 60,
      },
    };
  }, [h, settings, reserveX]);

  const range = useRef<[number, number]>([0, 0]);
  const fresh = () => {
    const r = new CrashRun(spec.pos, spec.guard, seed);
    range.current = rangeOf(r.pts.map((p) => p[1]).concat(r.guard.liq), 0.3);
    return r;
  };
  if (!run.current || run.current.pos.entry !== spec.pos.entry) run.current = fresh();

  useEffect(() => {
    run.current = fresh();
    tick((n) => n + 1);
  }, [spec, seed]);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const r = run.current!;
      if (reduce && r.crashing) {
        while (!r.over) r.step();
      } else {
        acc += dt * (r.crashing && !r.over ? (r.guard.inFlight ? FLIGHT_SPEED : CALM_SPEED) : 1);
        while (acc >= 1) {
          r.step();
          acc -= 1;
        }
      }
      tick((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return {
    run: run.current,
    range: range.current,
    start: () => {
      // The range is fixed for the whole crash, so the red line itself moves when the rescue lands.
      range.current = rangeOf(run.current!.forecast(), 0.1);
      run.current!.crashing = true;
    },
    again: () => setSeed((s) => s + 1),
  };
}

function useLiveMarket(coin: string) {
  const [pts, setPts] = useState<[number, number][]>([]);
  useEffect(() => {
    let stop = false;
    readCandles(coin, Date.now())
      .then((c) => !stop && setPts((p) => [...c, ...p]))
      .catch(() => {});
    const t = setInterval(() => {
      readMark(coin)
        .then((m) => {
          if (stop || m === null) return;
          setPts((p) => [...p.slice(-400), [Date.now() / 1000, m]]);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [coin]);
  return pts;
}

function Hunter({
  h,
  mark,
  liq,
  children,
  note,
}: {
  h: Holding;
  mark: number;
  liq: number | null;
  children: React.ReactNode;
  note: string;
}) {
  return (
    <section aria-label="What a hunter sees" className="min-w-0 rounded-[20px] border border-line bg-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[15px] font-semibold">What a hunter sees</h2>
        <span className="font-mono text-[12px] text-muted">{note}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[15px] tabular-nums">
        <span className="text-muted">
          Mark <span className="text-text">{price(mark)}</span>
        </span>
        <span className="flex items-center gap-2 text-red">
          <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-red" />
          Liq {liq === null ? '—' : price(liq)}
        </span>
        <span className="text-muted">{liq === null ? '' : `${distanceOf(liq, mark).toFixed(1)}% away`}</span>
        <span className="text-muted">
          {h.size.toLocaleString('en-US')} {h.coin}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Unlock({ g, onOpen }: { g: LocalGuard; onOpen(c: SealContents): void }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await readSealFile(g.file, pass);
      keepOpened(c);
      onOpen(c);
    } catch {
      setError("That passphrase doesn't open this seal file.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line pt-3">
      <label htmlFor="open-seal" className="text-[13px] text-muted">
        Your passphrase opens these, here on this device.
      </label>
      <div className="flex gap-2">
        <input
          id="open-seal"
          type="password"
          autoComplete="current-password"
          className={fieldCls}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
        <button type="submit" className={`${ghostBtn} shrink-0 px-4`} disabled={!pass || busy}>
          {busy ? 'Opening…' : 'Open'}
        </button>
      </div>
      <p role="alert" className="min-h-5 text-[13px] text-red">
        {error}
      </p>
    </form>
  );
}

function Sealed({
  g,
  settings,
  reserveText,
  onOpen,
  askElsewhere,
}: {
  g: ShownGuard;
  settings: GuardSettings | null;
  reserveText: string;
  onOpen(c: SealContents): void;
  /** The passphrase is already being asked for on this page. */
  askElsewhere?: boolean;
}) {
  const [peek, setPeek] = useState(false);
  const readable = settings !== null;
  const range = settings ? `${settings.line_range_pct[0]}–${settings.line_range_pct[1]}% from liquidation` : DOTS;
  const target = settings ? `${settings.target_range_pct[0]}–${settings.target_range_pct[1]}%` : DOTS;
  const shown = (text: string) => (peek ? text : DOTS);
  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel px-5 py-4 text-[15px]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted">Sealed settings</span>
        {readable && (
          <button
            type="button"
            className="min-h-9 select-none rounded-full border border-line-3 px-3 text-[13px] font-medium"
            onPointerDown={() => setPeek(true)}
            onPointerUp={() => setPeek(false)}
            onPointerLeave={() => setPeek(false)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setPeek(true)}
            onKeyUp={() => setPeek(false)}
          >
            Hold to peek
          </button>
        )}
      </div>
      {[
        ['Rescue range', range],
        ['Tops up to', target],
        ['Reserve', reserveText],
      ].map(([label, text]) => (
        <div key={label} className="flex items-center justify-between gap-4 border-t border-line pt-2.5">
          <span className="text-muted">{label}</span>
          <span className={`text-right font-medium tabular-nums ${peek ? '' : 'font-mono tracking-[0.2em]'}`}>
            {shown(text!)}
          </span>
        </div>
      ))}
      {!readable && g.local && !askElsewhere && <Unlock g={g.local} onOpen={onOpen} />}
      {readable && (
        <p className="text-[13px] text-muted">Only you can open these. They were sealed when you set the guard.</p>
      )}
    </div>
  );
}

function History({ rows }: { rows: HistoryRow[] }) {
  return (
    <section aria-label="Rescue history" className="overflow-hidden rounded-[20px] border border-line bg-panel">
      <h2 className="border-b border-line px-5 py-4 text-[17px] font-semibold">Rescue history</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-5 text-text-2">
          No rescues yet. Nothing moves unless the price reaches your sealed line.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px] tabular-nums">
            <thead className="text-[13px] text-muted">
              <tr>
                <th className="py-3 pl-5 pr-2 font-medium">When</th>
                <th className="px-2 py-3 font-medium">Margin added</th>
                <th className="px-2 py-3 font-medium">Landed in</th>
                <th className="py-3 pl-2 pr-5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-3.5 pl-5 pr-2">{r.when}</td>
                  <td className="px-2 py-3.5">{r.added}</td>
                  <td className="px-2 py-3.5">{r.landedIn}</td>
                  <td
                    className={`py-3.5 pl-2 pr-5 font-medium ${r.outcome === 'Saved' ? 'text-green' : r.outcome === 'Settling' ? 'text-amber' : r.outcome === 'Liquidated' ? 'text-red' : ''}`}
                  >
                    {r.outcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
        Ripcord charges only for saves: 3% of that rescue, 0.5% on any part above $50,000. A close call costs only the
        network fee.
      </p>
    </section>
  );
}

function Header({
  g,
  health,
  paused,
  dot,
}: {
  g: ShownGuard;
  health: string;
  paused: string | null;
  dot?: 'bg-green' | 'bg-red';
}) {
  // The health line is a sibling of the page's sections, not inside the title block, so it stays pinned to the top
  // while the chart plays a rescue below it (on a phone the card is a screen away by then).
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
          <Link
            href="/guards"
            className="inline-flex min-h-11 items-center underline decoration-line-3 underline-offset-4 hover:text-text"
          >
            Guards
          </Link>
        </div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]">{g.label}</h1>
      </div>
      {paused ? (
        <p role="alert" className="-mt-4 rounded-[12px] border border-red px-4 py-3 text-[15px] text-red">
          {paused}
        </p>
      ) : (
        <p
          aria-live="polite"
          className="sticky top-[env(safe-area-inset-top,0px)] z-20 -mx-1 -my-4 flex items-center gap-2 bg-ground px-1 py-2 text-[15px] text-text-2"
        >
          <span
            className={`h-[7px] w-[7px] shrink-0 rounded-full ${dot ?? (g.state === 'guarded' ? 'bg-amber' : 'bg-muted')}`}
          />
          {health}
        </p>
      )}
    </>
  );
}

interface Phase {
  state: CardState;
  status: string;
  health: string;
  sub: string;
  dot?: 'bg-green' | 'bg-red';
}

/** One state for the card's chip, its line, and the health line above the chart (DESIGN §5's words). */
function phaseOf(run: CrashRun, coin: string): Phase {
  const G = run.guard;
  const f = G.inFlight;
  const last = G.rescues[G.rescues.length - 1];
  const landedIn = last && last.landedAt !== null ? last.landedAt - last.firedAt : 0;
  const moved = run.pos.side > 0 ? 'fell' : 'rose';
  if (G.phase === 'liquidated') {
    return {
      state: 'paused',
      status: 'Liquidated',
      health:
        'Liquidated. The price fell past the margin this rescue added. Verify says whether our promise covers it.',
      sub: 'liquidated',
      dot: 'bg-red',
    };
  }
  if (f) {
    const amount = `${Math.round(f.amount).toLocaleString('en-US')} USDC`;
    return {
      state: 'rescuing',
      status: 'Rescuing…',
      health: `Rescuing… ${mmss(run.t - f.firedAt)} · ${amount} on its way to your margin`,
      sub: `rescue on its way · ${mmss(run.t - f.firedAt)}`,
    };
  }
  if (run.savedAt !== null && run.oldLiq !== null && run.landedAt !== null) {
    return {
      state: 'rescued',
      status: 'Saved',
      health: `Saved. ${coin} ${moved} past your old liquidation price (${price(run.oldLiq)}). Your reserve had moved it to ${price(G.liq)}, ${run.savedAt - run.landedAt} s earlier.`,
      sub: 'from liquidation',
      dot: 'bg-green',
    };
  }
  if (run.landedAt !== null && run.oldLiq !== null && run.t < run.landedAt + 20) {
    return {
      state: 'rescued',
      status: 'Rescued',
      health: `Rescued · landed in ${landedIn} s · Liq ${price(run.oldLiq)} → ${price(G.liq)}`,
      sub: `landed in ${landedIn} s`,
      dot: 'bg-green',
    };
  }
  if (run.landedAt !== null && run.oldLiq !== null) {
    // Until the price crosses the old line (a save) or 24 h pass (a close call), the rescue is settling.
    return {
      state: 'guarded',
      status: 'Settling',
      health: `Settling · it counts as a save if ${coin} ${moved === 'fell' ? 'falls' : 'rises'} past ${price(run.oldLiq)} in the next 24 h`,
      sub: 'from liquidation',
    };
  }
  return {
    state: 'guarded',
    status: 'Guarded',
    health: `Guarded · checked ${run.t % 3 || 3} s ago`,
    sub: 'from liquidation',
  };
}

function ExampleGuard({
  g,
  h,
  settings,
  reserveX,
}: {
  g: ShownGuard;
  h: Holding;
  settings: GuardSettings | null;
  reserveX: number;
}) {
  const { run, range, start, again } = useCrash(h, settings, reserveX);
  const [opened, setOpened] = useState<SealContents | null>(g.local ? openedSeal(g.id) : null);
  const [openedAt] = useState(() => Date.now());
  const G = run.guard;
  const crashing = run.crashing;
  const shownSettings = g.example ? settings : (opened?.settings ?? null);
  const p = phaseOf(run, h.coin);
  const rows: HistoryRow[] = G.rescues
    .filter((r) => r.landedAt !== null)
    .map((r) => ({
      when: 'Just now',
      added: usd(r.amount, 2),
      landedIn: `${(r.landedAt as number) - r.firedAt} s`,
      outcome: OUTCOME[r.outcome] ?? 'Settling',
    }));
  const d = distanceOf(G.liq, run.price);
  const simClock = (t: number) => hhmm(openedAt + (t - run.windowS) * 1000);

  return (
    <div className="flex flex-col gap-6">
      <Header g={g} health={p.health} paused={null} dot={p.dot} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1">
          <Hunter
            h={h}
            mark={run.price}
            liq={G.liq}
            note={`simulated${crashing && !run.over ? ` · ${G.inFlight ? FLIGHT_SPEED : CALM_SPEED}× speed` : ''}`}
          >
            <RescueChart
              pts={run.pts}
              t0={run.t - run.windowS}
              t1={run.t}
              lo={range[0]}
              hi={range[1]}
              liq={G.liq}
              oldLiq={run.oldLiq}
              landed={run.landedAt !== null ? [run.landedAt, run.landedPrice] : null}
              timeLabel={simClock}
              label="The position's price and its public liquidation price."
            />
          </Hunter>
          {!crashing ? (
            <button type="button" className={`${primaryBtn} w-full sm:w-fit`} onClick={start}>
              Try a crash
            </button>
          ) : run.over ? (
            <button type="button" className={`${ghostBtn} w-full sm:w-fit`} onClick={again}>
              Run it again
            </button>
          ) : (
            <p className="text-[13px] text-muted">
              Prices are simulated. The decisions are the guard&apos;s real rules.
            </p>
          )}
        </div>
        <aside aria-label="Your guard" className="order-1 flex flex-col gap-4 lg:order-2">
          <Card3D>
            <GuardCard
              label={g.label}
              distance={<Ticker value={d} suffix="%" />}
              sub={p.sub}
              fingerprint={g.fingerprint}
              commitment={g.commitment}
              state={p.state}
              status={p.status}
              reserve={DOTS}
              depth
            />
          </Card3D>
          <Sealed
            g={g}
            settings={shownSettings}
            reserveText={g.example?.reserve ?? (opened ? reserveWords(opened.settings) : DOTS)}
            onOpen={setOpened}
          />
          {g.local && (
            <button type="button" className={ghostBtn} onClick={() => downloadSealFile(g.local!)}>
              Save seal file
            </button>
          )}
        </aside>
      </div>
      <History rows={rows} />
    </div>
  );
}

function rangeFrom(pts: [number, number][], liq: number | null): { lo: number; hi: number } {
  const [lo, hi] = rangeOf(pts.map((p) => p[1]).concat(liq ?? []), 0.08);
  return { lo, hi };
}

const reserveWords = (s: GuardSettings) => `${usd(s.budget_usd)} in ${assetOf(s.reserve_asset).symbol}`;

function LiveGuard({ g, h }: { g: ShownGuard; h: Holding | null }) {
  const local = g.local as LocalGuard;
  const { session } = useSession();
  const backend = backendFor(session);
  const pts = useLiveMarket(g.coin);
  const [opened, setOpened] = useState<SealContents | null>(openedSeal(g.id));
  const [state, setState] = useState(stateOf(local));
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [onChain, setOnChain] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<OnChainReceipt[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const read = () => {
      lastCheck(g.id)
        .then(setCheckedAt)
        .catch(() => {});
      readGuard(g.id)
        .then((r) => setOnChain(r?.status ?? null))
        .catch(() => {});
      readReceipts(g.id)
        .then((r) => setReceipts(r ?? []))
        .catch(() => {});
      setNow(Date.now());
    };
    read();
    const t = setInterval(read, 30_000);
    return () => clearInterval(t);
  }, [g.id]);

  const stale = checkedAt !== null && now - checkedAt > PAUSED_AFTER_MS;
  const paused =
    state === 'guarded' && stale
      ? `Guard paused. Checks stopped at ${clockOf(checkedAt as number)}. Your reserve is safe, but your position isn't protected until they resume.`
      : null;
  const shownState: CardState = paused ? 'paused' : state === 'guarded' ? 'guarded' : 'draft';
  const status = paused ? 'Paused' : STATE_TEXT[state];
  const health =
    state !== 'guarded'
      ? STATE_TEXT[state]
      : checkedAt !== null
        ? `Guarded · checked ${Math.max(1, Math.round((now - checkedAt) / 1000))} s ago`
        : onChain === 'Pending'
          ? 'Guarded · first check coming'
          : 'Guarded';
  const mark = pts[pts.length - 1]?.[1] ?? h?.mark ?? 0;
  const liq = h?.liquidation ?? null;
  const d = liq === null || !mark ? null : distanceOf(liq, mark);

  const rows: HistoryRow[] = receipts.map((r) => {
    let added = `about ${usd(r.public.credit_usd)}`;
    if (opened) {
      try {
        const plain = open(hexToBytes(opened.receipt_secret), hexToBytes(r.sealed), g.id);
        added = usd((JSON.parse(new TextDecoder().decode(plain)) as { amount_usd: number }).amount_usd, 2);
      } catch {
        // The public, rounded figure still stands.
      }
    }
    return {
      when: new Date(r.public.at_hour * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
      added,
      landedIn: `${r.public.latency_s} s`,
      outcome: OUTCOME[r.public.outcome] ?? 'Settling',
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <Header g={{ ...g, state }} health={health} paused={paused} />
      {state !== 'guarded' && (
        <section aria-label="Finish setting up" className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
          {!opened ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Open your seal file to finish.</h2>
              <Unlock g={local} onOpen={setOpened} />
            </div>
          ) : state === 'approval' && session ? (
            <Approve
              contents={opened}
              backend={backend}
              isDemo={false}
              owner={session.address}
              onDone={() => {
                patchGuard(g.id, { approved: true });
                setState(local.funded ? 'guarded' : 'waiting');
              }}
            />
          ) : (
            <Fund
              contents={opened}
              backend={backend}
              isDemo={false}
              fallback={reserveWords(opened.settings)}
              onFunded={() => {
                patchGuard(g.id, { funded: true });
                setState('guarded');
              }}
            />
          )}
        </section>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="order-2 min-w-0 lg:order-1">
          {h ? (
            <Hunter h={h} mark={mark} liq={liq} note="live from Hyperliquid">
              <RescueChart
                pts={pts}
                t0={pts[0]?.[0] ?? 0}
                t1={pts[pts.length - 1]?.[0] ?? 1}
                {...rangeFrom(pts, liq)}
                liq={liq}
                timeLabel={(t) => hhmm(t * 1000)}
                label={`${g.coin} price over the last hour and its public liquidation price.`}
              />
            </Hunter>
          ) : (
            <p className="rounded-[20px] border border-line bg-panel px-5 py-6 text-text-2">
              This position isn&apos;t open on the connected account.
            </p>
          )}
        </div>
        <aside aria-label="Your guard" className="order-1 flex flex-col gap-4 lg:order-2">
          <Card3D>
            <GuardCard
              label={g.label}
              distance={d === null ? '—' : pct(d)}
              sub="from liquidation"
              fingerprint={g.fingerprint}
              commitment={g.commitment}
              state={shownState}
              status={status}
              reserve={DOTS}
              depth
            />
          </Card3D>
          <Sealed
            g={g}
            settings={opened?.settings ?? null}
            reserveText={opened ? reserveWords(opened.settings) : DOTS}
            onOpen={setOpened}
            askElsewhere={state !== 'guarded'}
          />
          <button type="button" className={ghostBtn} onClick={() => downloadSealFile(local)}>
            Save seal file
          </button>
        </aside>
      </div>
      <History rows={rows} />
    </div>
  );
}

function Page({ id }: { id: string }) {
  const { ready, session } = useSession();
  const { account } = useAccount(session);
  const [local, setLocal] = useState<LocalGuard[] | null>(null);
  useEffect(() => setLocal(loadGuards()), []);
  if (!ready || !local) return <div className="flex-1" />;
  if (!session) return <Connect />;
  const isDemo = session.kind === 'demo';
  const guards = guardsFor(session.address, isDemo, local);
  const g = guards.find((x) => x.id === id);
  if (!g) {
    return (
      <div className="my-auto flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">This guard isn&apos;t on this account here.</h1>
        <p className="max-w-[28rem] text-text-2">Connect the account it guards, or open its seal file from Guards.</p>
        <Link href="/guards" className={primaryBtn}>
          Back to guards
        </Link>
      </div>
    );
  }
  if (!account)
    return <div aria-busy="true" className="h-[420px] animate-pulse rounded-[20px] border border-line bg-panel" />;
  const h =
    account.holdings.find((x) => guardOf(x, [g])?.id === g.id && (x.coin === g.coin || g.margin === 'cross')) ?? null;
  if (isDemo && h) {
    const settings = exampleSettings(g.id) ?? openedSeal(g.id)?.settings ?? null;
    const budget = openedSeal(g.id)?.settings.budget_usd;
    const reserveX = g.example?.reserveX ?? (budget ? budget / h.marginUsed : 1.4);
    return <ExampleGuard g={g} h={h} settings={settings} reserveX={reserveX} />;
  }
  return <LiveGuard g={g} h={h} />;
}

export function GuardView({ id }: { id: string }) {
  return (
    <SessionProvider>
      <AppShell>
        <Page id={id} />
      </AppShell>
    </SessionProvider>
  );
}
