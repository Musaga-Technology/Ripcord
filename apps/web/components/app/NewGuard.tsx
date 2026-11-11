'use client';

// New guard (docs/DESIGN.md §4.4): the reserve first, then when to step in, then the seal. Everything sealed is made in
// this browser; only three hashes and an envelope only the enclave can open leave it. The card beside the steps is a
// preview until the seal, when it prints itself (§8.1).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  createInput,
  MIN_RESERVE_USD,
  prepareGuard,
  presetRanges,
  writeSealFileKeyed,
  type PreparedGuard,
  type Preset,
} from '@ripcord/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ASSETS, demoPrices, suggestAmount, USDC_NEAR, type Prices } from '../../lib/assets';
import { random, watch } from '../../lib/backend';
import { guardOf, guardsFor, labelOf, watchedDistance } from '../../lib/guards';
import type { Holding } from '../../lib/hl';
import { markedPreset, replayFigure } from '../../lib/replay';
import { reserveToSurvive, type Intent } from '../../lib/copilot';
import { backendFor, SessionProvider, useAccount, useSession } from '../../lib/session';
import { accountUrl, REGISTRY } from '../../lib/near';
import { radioKeys } from '../../lib/radio';
import { downloadSealFile, keepOpened, loadGuards, saveGuard, type LocalGuard } from '../../lib/store';
import { pct, price, usd } from '../format';
import { GuardCard } from '../GuardCard';
import { Card3D } from '../site/Card3D';
import { connectNearOwner, type NearOwner } from '../../lib/nearWallet';
import { AppShell, fieldCls, ghostBtn, primaryBtn } from './AppShell';
import { PlainWords } from './PlainWords';
import { PriceLadder } from './PriceLadder';
import { Connect } from './Connect';
import { Approve, explain, Fund } from './steps';

const PRESETS: { id: Preset; name: string; line: string }[] = [
  { id: 'safer', name: 'Safer', line: 'Steps in early: more close calls, fewer surprises.' },
  { id: 'balanced', name: 'Balanced', line: 'Steps in midway.' },
  { id: 'lean', name: 'Lean', line: 'Waits longest, so the reserve lasts for a second rescue.' },
];
const GUARD_DAYS = 90;
const DOTS = '••••••';
const DRAFT_PRINT = '•••• •••• ···· ••••';

type Phase = 'edit' | 'sealing' | 'save' | 'approve' | 'fund' | 'guarded';

const pctRange = ([a, b]: [number, number]) => `${Math.round(a)}–${Math.round(b)}%`;

function usePrices(isDemo: boolean): Prices | null {
  const [prices, setPrices] = useState<Prices | null>(isDemo ? demoPrices() : null);
  useEffect(() => {
    if (isDemo) return;
    fetch('/api/tokens')
      .then((r) => (r.ok ? (r.json() as Promise<Prices>) : null))
      .then(setPrices)
      .catch(() => setPrices(null));
  }, [isDemo]);
  return prices;
}

/** The price near which a range steps in: the midpoint of its line, as a price. */
function stepsInAt(h: Holding, line: [number, number]): number {
  const s = h.side === 'Long' ? -1 : 1;
  const mid = (line[0] + line[1]) / 200;
  return (h.liquidation ?? h.mark) / (1 + s * mid);
}

function Chooser({ holdings }: { holdings: Holding[] }) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
      <h1 className="text-[36px] font-semibold leading-none tracking-[-0.04em]">Which position?</h1>
      <ul className="overflow-hidden rounded-[20px] border border-line bg-panel">
        {holdings.map((h) => (
          <li key={h.coin} className="border-t border-line first:border-t-0">
            <Link
              href={`/guards/new?coin=${encodeURIComponent(h.coin)}`}
              className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 tabular-nums hover:bg-line/30"
            >
              <span className="font-semibold">{labelOf(h)}</span>
              <span className="text-[15px] text-text-2">{h.distance === null ? '—' : `${pct(h.distance)} away`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Flow({ holding, all }: { holding: Holding; all: Holding[] }) {
  const router = useRouter();
  const { session } = useSession();
  const isDemo = session?.kind === 'demo';
  const backend = backendFor(session);
  const prices = usePrices(isDemo);

  const crossMargin = all.filter((h) => h.margin === 'cross').reduce((s, h) => s + h.marginUsed, 0);
  const margin = holding.margin === 'isolated' ? holding.marginUsed : crossMargin;
  const distance = watchedDistance(holding, all) ?? 0;
  // A cross guard watches the nearest cross position, so its prices are that position's.
  const watched =
    holding.margin === 'cross'
      ? (all
          .filter((h) => h.margin === 'cross' && h.distance !== null)
          .sort((a, b) => (a.distance as number) - (b.distance as number))[0] ?? holding)
      : holding;

  // USDC first: a Hyperliquid trader already holds it, and a USDC rescue needs no swap, so it lands fastest and cheapest.
  const [assetIx, setAssetIx] = useState(() =>
    Math.max(
      0,
      ASSETS.findIndex((a) => a.reserve === USDC_NEAR),
    ),
  );
  const asset = ASSETS[assetIx]!;
  const assetPrice = prices?.[asset.source] ?? null;
  const [amount, setAmount] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Preset | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  // A pasted address isn't proven to be the visitor's own, and a guard pays only that account.
  const pasted = session?.kind === 'address';
  const [mine, setMine] = useState(false);
  // Who signs for the guard: the seal file's own key (most private), or the owner's NEAR wallet.
  const [ownBy, setOwnBy] = useState<'key' | 'near'>('key');
  const [nearOwner, setNearOwner] = useState<NearOwner | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [nearError, setNearError] = useState<string | null>(null);
  const connectNear = async () => {
    setConnecting(true);
    setNearError(null);
    try {
      setNearOwner(await connectNearOwner());
      setPrepared(null);
    } catch (e) {
      setNearError(
        e instanceof Error && e.message
          ? `${e.message[0]!.toUpperCase()}${e.message.slice(1)}.`
          : "The wallet didn't connect.",
      );
    } finally {
      setConnecting(false);
    }
  };

  const suggestion = assetPrice ? suggestAmount(asset, margin * 2, assetPrice) : '';
  const amountStr = amount ?? suggestion;
  const reserveUsd = assetPrice ? (Number(amountStr) || 0) * assetPrice : 0;
  const reserveX = margin > 0 ? reserveUsd / margin : 0;
  const marked = markedPreset(holding.coin, holding.leverage, reserveX);
  const preset = chosen ?? marked;
  const ranges = presetRanges(preset, distance);
  const figure = replayFigure(holding.coin, holding.leverage, reserveX, preset);
  const atTwo = replayFigure(holding.coin, holding.leverage, 2, preset);

  /** Fills the form from the trader's words; the amounts are computed here, never taken from the model. */
  const applyIntent = (i: Intent): string => {
    const ix = i.asset ? ASSETS.findIndex((a) => a.symbol === i.asset) : -1;
    const next = ix >= 0 ? ASSETS[ix]! : asset;
    if (ix >= 0) setAssetIx(ix);
    if (i.preset) setChosen(i.preset);
    const unitPrice = prices?.[next.source] ?? null;
    const drop = i.surviveDropPct;
    const survive = drop !== null ? reserveToSurvive(watched, drop) : null;
    const wanted = i.reserveUsd ?? (survive !== null && survive > 0 ? survive : null);
    const usdNow = wanted !== null && unitPrice ? Math.max(wanted, MIN_RESERVE_USD) : null;
    setAmount(usdNow !== null && unitPrice ? suggestAmount(next, usdNow, unitPrice) : null);
    const parts = [
      usdNow !== null ? `a ${usd(usdNow)} reserve in ${next.symbol}` : `a reserve in ${next.symbol}`,
      drop !== null && survive === 0 ? `it already survives a ${drop}% drop` : null,
      drop !== null && survive !== null && survive > 0 ? `enough to survive a ${drop}% drop` : null,
      i.preset ? `${i.preset[0]!.toUpperCase()}${i.preset.slice(1)}` : null,
    ].filter(Boolean);
    const said = i.say.replace(/[\s.!]+$/, '');
    return `${said ? `“${said}”: ` : ''}${parts.join(', ')}.`;
  };

  const [phase, setPhase] = useState<Phase>('edit');
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedGuard | null>(null);
  const [local, setLocal] = useState<LocalGuard | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(0);
  const [typed, setTyped] = useState(0);

  const previewHash = useMemo(
    () => bytesToHex(sha256(utf8ToBytes(`${holding.coin}|${asset.symbol}|${amountStr}|${preset}`))),
    [holding.coin, asset.symbol, amountStr, preset],
  );

  // A retry after a failed seal keeps the same guard id, so it can't leave a second guard behind, unless the
  // settings changed since.
  const preparedFor = useRef<string | null>(null);
  const reduce = useRef(false);
  useEffect(() => {
    reduce.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Why Seal is blocked, said under the button rather than left to guess.
  const blocker = !ranges
    ? 'This position is too close to liquidation for this choice.'
    : !assetPrice
      ? 'Reading prices…'
      : reserveUsd < MIN_RESERVE_USD
        ? `A reserve needs at least $${MIN_RESERVE_USD}.`
        : pass.length < 8
          ? 'Your passphrase needs 8 or more characters.'
          : pass !== pass2
            ? "The two passphrases don't match yet."
            : pasted && !mine
              ? 'Confirm the account is yours.'
              : ownBy === 'near' && !nearOwner
                ? 'Connect your NEAR wallet first.'
                : '';
  const canSeal = phase === 'edit' && blocker === '';

  /** The seal (DESIGN §8.1): the rosette prints, each sealed value collapses, the fingerprint types in. */
  const playSeal = async (fingerprint: string) => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, reduce.current ? 0 : ms));
    await wait(900);
    for (let i = 1; i <= 3; i++) {
      setCollapsed(i);
      await wait(120);
    }
    await new Promise<void>((resolve) => {
      if (reduce.current) {
        setTyped(fingerprint.length);
        resolve();
        return;
      }
      let n = 0;
      const frame = () => {
        n += 1;
        setTyped(n);
        if (n < fingerprint.length) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  };

  const seal = async () => {
    if (!session || !ranges) return;
    setError(null);
    setPhase('sealing');
    try {
      const reuse = prepared && preparedFor.current === previewHash;
      const p = reuse
        ? prepared
        : prepareGuard(
            {
              hl_address: session.address,
              preset,
              distance,
              budget_usd: reserveUsd,
              reserve_asset: asset.reserve,
              isolated: holding.margin === 'isolated' ? holding.coin : null,
              days: GUARD_DAYS,
              owner: ownBy === 'near' && nearOwner ? nearOwner : undefined,
            },
            random,
            Date.now(),
          );
      preparedFor.current = previewHash;
      setPrepared(p);
      keepOpened(p.contents);
      const animation = playSeal(p.fingerprint);
      const [{ file, key }] = await Promise.all([
        writeSealFileKeyed(p.contents, p.commitment, pass, random),
        backend.pubkey().then((pk) => backend.create(createInput(p, pk, random), p.contents.receipt_secret)),
        animation,
      ]);
      keepOpened(p.contents, key);
      const g: LocalGuard = {
        id: p.contents.guard_id,
        commitment: p.commitment,
        fingerprint: p.fingerprint,
        address: session.address.toLowerCase(),
        coin: holding.coin,
        label: labelOf(holding),
        margin: holding.margin,
        demo: isDemo,
        funded: false,
        approved: false,
        file,
        created_at: Date.now(),
      };
      saveGuard(g);
      setLocal(g);
      void watch(p.contents);
      setPhase('save');
    } catch (e) {
      setError(explain(e, 'the seal'));
      setCollapsed(0);
      setTyped(0);
      setPhase('edit');
    }
  };

  const sealedShown = phase !== 'edit';
  const shown = (i: number, text: string) => (collapsed >= i ? DOTS : text);
  const fp = prepared?.fingerprint;
  const fingerprintText = fp && sealedShown ? fp.slice(0, typed) + DRAFT_PRINT.slice(typed) : DRAFT_PRINT;
  const finished = phase === 'guarded';
  const cardState = finished ? 'guarded' : 'draft';
  const status = finished
    ? 'Guarded'
    : phase === 'sealing'
      ? 'Sealing…'
      : phase === 'fund'
        ? 'Waiting for reserve'
        : phase === 'approve'
          ? 'Needs approval'
          : sealedShown
            ? 'Sealed'
            : 'Not sealed';

  const afterSave = () => setPhase(holding.margin === 'isolated' ? 'approve' : 'fund');

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
      <div className="order-2 flex min-w-0 flex-col gap-9 lg:order-1">
        {phase !== 'edit' && phase !== 'sealing' && <Progress phase={phase} isolated={holding.margin === 'isolated'} />}
        {phase === 'edit' || phase === 'sealing' ? (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-[36px] font-semibold leading-none tracking-[-0.04em] sm:text-[48px]">
                Guard {holding.coin} {holding.side.toLowerCase()}.
              </h1>
              <p className="text-[15px] text-text-2">
                {holding.margin === 'cross'
                  ? 'Cross margin, so no approval is needed. An isolated position takes one approval on Hyperliquid, so a rescue can reach it.'
                  : 'Isolated margin, so this guard needs one approval on Hyperliquid. Its code only adds margin.'}
              </p>
            </div>

            <PlainWords holding={watched} disabled={phase !== 'edit'} onIntent={applyIntent} />

            <section aria-label="Reserve" className="flex flex-col gap-3">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Your reserve</h2>
              <div role="radiogroup" aria-label="Reserve asset" className="flex flex-wrap gap-2">
                {ASSETS.map((a, i) => (
                  <button
                    key={a.symbol}
                    type="button"
                    role="radio"
                    aria-checked={i === assetIx}
                    tabIndex={i === assetIx ? 0 : -1}
                    onKeyDown={radioKeys}
                    disabled={phase !== 'edit'}
                    onClick={() => {
                      setAssetIx(i);
                      setAmount(null);
                    }}
                    className={`min-h-11 rounded-full border px-4 text-[15px] font-medium transition-colors duration-[120ms] ${i === assetIx ? 'border-text bg-text text-ground' : 'border-line-3 hover:border-muted'}`}
                  >
                    {a.symbol}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-[240px]">
                  <input
                    aria-label={`Reserve amount in ${asset.symbol}`}
                    inputMode="decimal"
                    className={`${fieldCls} pr-16 text-[20px] font-semibold`}
                    value={amountStr}
                    disabled={phase !== 'edit'}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] text-muted">
                    {asset.symbol}
                  </span>
                </div>
                <span className="text-[15px] tabular-nums text-text-2">
                  {assetPrice ? (
                    <>
                      {usd(reserveUsd)} ·{' '}
                      <span className="font-medium text-text">
                        {reserveX < 1 ? reserveX.toPrecision(2) : reserveX.toFixed(1)}×
                      </span>{' '}
                      your {usd(margin)} margin
                    </>
                  ) : (
                    'Reading prices…'
                  )}
                </span>
              </div>
              {assetPrice && suggestion !== amountStr && phase === 'edit' && (
                <button
                  type="button"
                  className="w-fit text-[15px] font-medium underline decoration-line-3 underline-offset-4 hover:decoration-text"
                  onClick={() => setAmount(null)}
                >
                  Use {suggestion} {asset.symbol}
                </button>
              )}
              <p className="text-[15px] text-text-2">
                {figure ? (
                  <>
                    At {figure.band}× margin, <span className="font-medium text-text">{figure.liquidated}%</span> of
                    replayed positions were liquidated, against {figure.unguarded}% with no guard.
                    {reserveX < 2 && atTwo ? ` At 2×, ${atTwo.liquidated}%.` : ''}
                  </>
                ) : (
                  "Below half your margin, the replays can't say how often it holds."
                )}
              </p>
            </section>

            <section aria-label="When to step in" className="flex flex-col gap-3">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">When to step in</h2>
              {ranges && watched.liquidation !== null && (
                <PriceLadder
                  side={watched.side}
                  mark={watched.mark}
                  liq={watched.liquidation ?? watched.mark}
                  line={ranges.line_range_pct}
                  target={ranges.target_range_pct}
                />
              )}
              <div role="radiogroup" aria-label="When to step in" className="grid gap-2 sm:grid-cols-3">
                {PRESETS.map((p) => {
                  const r = presetRanges(p.id, distance);
                  const f = replayFigure(holding.coin, holding.leverage, reserveX, p.id);
                  const on = p.id === preset;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on ? 0 : -1}
                      onKeyDown={radioKeys}
                      disabled={!r || phase !== 'edit'}
                      onClick={() => setChosen(p.id)}
                      className={`flex min-h-11 flex-col gap-1 rounded-[20px] border p-4 text-left transition-colors duration-[120ms] disabled:opacity-40 ${on ? 'border-text' : 'border-line hover:border-line-3'} bg-panel`}
                    >
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        {p.name}
                        {p.id === marked && figure && (
                          <span className="h-[7px] w-[7px] rounded-full bg-amber" title="Suits your reserve" />
                        )}
                      </span>
                      <span className="text-[13px] text-muted">{p.line}</span>
                      <span className="mt-1.5 text-[15px] tabular-nums">
                        {r && watched.liquidation !== null
                          ? `Steps in near ${price(stepsInAt(watched, r.line_range_pct))}`
                          : 'Too close'}
                      </span>
                      {f && (
                        <span className="text-[13px] tabular-nums text-text-2">
                          {f.liquidated}% liquidated · {f.earlyMonth} close calls a month
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[13px] text-muted">
                {figure ? (
                  <>
                    <span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full bg-amber" />
                    {`${PRESETS.find((p) => p.id === marked)!.name} had the fewest liquidations in the replays at this reserve. `}
                  </>
                ) : null}
                {figure?.source ?? ''} A close call still adds to your margin, and costs only the network fee.
              </p>
              {!ranges && (
                <p className="text-[15px] text-red">This position is too close to liquidation for this choice.</p>
              )}
            </section>

            <section aria-label="Seal" className="flex flex-col gap-3 border-t border-line pt-7">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Your seal file</h2>
              <p className="text-[15px] text-text-2">
                It holds your settings and the key to your reserve. Choose a passphrase to lock it. Nobody can reset it.
              </p>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSeal) void seal();
                }}
              >
                {!isDemo && (
                  <fieldset className="flex max-w-[640px] flex-col gap-2" disabled={phase !== 'edit'}>
                    <legend className="pb-2 text-[13px] text-muted">Who signs for this guard</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(
                        [
                          ['key', 'Your seal file', 'Most private: nothing on chain points to you.'],
                          [
                            'near',
                            'Your NEAR wallet',
                            'Freeze it from any device with just your wallet. Your NEAR account is named on chain when you freeze, top up or change the range.',
                          ],
                        ] as const
                      ).map(([id, name, note]) => (
                        <label
                          key={id}
                          className={`flex cursor-pointer items-start gap-3 rounded-[16px] border px-4 py-3 text-[14px] transition-colors duration-[120ms] ${ownBy === id ? 'border-text' : 'border-line hover:border-line-3'}`}
                        >
                          <input
                            type="radio"
                            name="owner"
                            className="mt-1 accent-[var(--text)]"
                            checked={ownBy === id}
                            onChange={() => {
                              setOwnBy(id);
                              setPrepared(null);
                            }}
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="font-semibold">{name}</span>
                            <span className="text-text-2">{note}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    {ownBy === 'near' && (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {nearOwner ? (
                          <p className="text-[15px] text-text-2">
                            Signs as <span className="font-mono text-[13px] text-text">{nearOwner.account}</span>
                          </p>
                        ) : null}
                        <button
                          type="button"
                          className={`${ghostBtn} min-h-11 px-4 text-[14px]`}
                          disabled={connecting}
                          onClick={() => void connectNear()}
                        >
                          {connecting
                            ? 'Waiting for your wallet…'
                            : nearOwner
                              ? 'Use another wallet'
                              : 'Connect NEAR wallet'}
                        </button>
                        {nearError && (
                          <p role="alert" className="text-[15px] text-red">
                            {nearError}
                          </p>
                        )}
                      </div>
                    )}
                  </fieldset>
                )}
                <div className="grid max-w-[520px] gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-[13px] text-muted">
                    Passphrase
                    <input
                      type="password"
                      autoComplete="new-password"
                      aria-describedby="seal-blocker"
                      className={fieldCls}
                      value={pass}
                      disabled={phase !== 'edit'}
                      onChange={(e) => setPass(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-[13px] text-muted">
                    Repeat it
                    <input
                      type="password"
                      autoComplete="new-password"
                      aria-describedby="seal-blocker"
                      className={fieldCls}
                      value={pass2}
                      disabled={phase !== 'edit'}
                      onChange={(e) => setPass2(e.target.value)}
                    />
                  </label>
                </div>
                {pasted && session && (
                  <label className="flex items-start gap-3 text-[15px] text-text-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-[var(--text)]"
                      checked={mine}
                      disabled={phase !== 'edit'}
                      onChange={(e) => setMine(e.target.checked)}
                    />
                    <span>
                      This is my Hyperliquid account. The guard only ever pays{' '}
                      <span className="font-mono text-[13px] text-text">
                        {session.address.slice(0, 6)}…{session.address.slice(-4)}
                      </span>
                      .
                    </span>
                  </label>
                )}
                <div className="flex flex-col gap-1 pt-2 text-[13px] text-muted">
                  <p>A rescue takes under a minute. A move faster than that can still liquidate you.</p>
                  <p>
                    No Ripcord fee unless a rescue saves you, then 3% of it · $1 a month · about $0.32 network cost per
                    rescue
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="submit"
                    className={`${primaryBtn} mt-1 w-full sm:w-fit`}
                    disabled={!canSeal}
                    aria-describedby="seal-blocker"
                  >
                    {phase === 'sealing' ? 'Sealing…' : 'Seal guard'}
                  </button>
                  <p id="seal-blocker" className="text-[13px] text-muted">
                    {phase === 'edit' ? blocker : ''}
                  </p>
                </div>
              </form>
              <p role="alert" className="min-h-6 text-[15px] text-red">
                {error}
              </p>
            </section>
          </>
        ) : phase === 'save' && local ? (
          <div className="step-in flex flex-col items-start gap-4">
            <h2 className="text-[36px] font-semibold leading-none tracking-[-0.04em]">Sealed.</h2>
            <p className="max-w-[34rem] text-[15px] text-text-2">
              Your settings went to OutLayer&apos;s enclave on NEAR, encrypted on this device. The guard registry on
              NEAR holds only a fingerprint. Keep your seal file somewhere safe: it proves what you sealed, and
              it&apos;s how you close the guard from another device.
            </p>
            <a
              href={accountUrl(REGISTRY)}
              className="inline-flex min-h-9 items-center gap-1.5 text-[14px] font-medium underline decoration-line-3 underline-offset-4 hover:decoration-text"
            >
              The guard registry on NEAR
              <span aria-hidden="true">↗</span>
            </a>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={saved ? ghostBtn : primaryBtn}
                onClick={() => setSaved(downloadSealFile(local))}
              >
                {saved ? 'Save it again' : 'Save seal file'}
              </button>
              <button type="button" className={saved ? primaryBtn : ghostBtn} disabled={!saved} onClick={afterSave}>
                {holding.margin === 'isolated' ? 'Continue to approval' : 'Fund reserve'}
              </button>
            </div>
            <p aria-live="polite" className="min-h-5 text-[13px] text-muted">
              {saved ? `Saved as ${saved}. A copy also stays in this browser.` : ''}
            </p>
          </div>
        ) : phase === 'approve' && prepared && session ? (
          <Approve
            contents={prepared.contents}
            backend={backend}
            isDemo={isDemo}
            owner={session.address}
            onDone={() => {
              if (local) saveGuard({ ...local, approved: true });
              setLocal((l) => (l ? { ...l, approved: true } : l));
              setPhase('fund');
            }}
          />
        ) : phase === 'fund' && prepared && local ? (
          <Fund
            contents={prepared.contents}
            backend={backend}
            isDemo={isDemo}
            wallet={session?.kind === 'wallet' ? session.address : null}
            fallback={amountStr}
            onFunded={() => {
              saveGuard({ ...local, funded: true });
              setPhase('guarded');
            }}
          />
        ) : (
          <div className="step-in flex flex-col items-start gap-4">
            <h2 className="text-[36px] font-semibold leading-none tracking-[-0.04em]">Guarded.</h2>
            <p className="max-w-[34rem] text-[15px] text-text-2">
              Near liquidation, part of your reserve lands in your Hyperliquid margin as USDC. Nobody sees it coming.
            </p>
            <button type="button" className={primaryBtn} onClick={() => router.push(`/guards/${local?.id ?? ''}`)}>
              Open guard
            </button>
          </div>
        )}
      </div>

      <aside aria-label="Your guard" className="order-1 flex flex-col gap-5 lg:sticky lg:top-7 lg:order-2">
        <div className="mx-auto w-full max-w-[460px]">
          <Card3D>
            <GuardCard
              key={sealedShown ? prepared?.commitment : 'preview'}
              label={labelOf(holding)}
              distance={pct(distance)}
              sub="from liquidation"
              fingerprint={fingerprintText}
              commitment={sealedShown && prepared ? prepared.commitment : previewHash}
              state={cardState}
              status={status}
              reserve={sealedShown ? DOTS : `${amountStr || '0'} ${asset.symbol}`}
              print={sealedShown}
              depth
            />
          </Card3D>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel px-5 py-4 text-[15px]">
          <span className="text-[13px] text-muted">{sealedShown ? 'Sealed' : 'What gets sealed'}</span>
          <SealedRow
            label="Rescue range"
            value={shown(1, ranges ? `${pctRange(ranges.line_range_pct)} away` : '—')}
            dots={collapsed >= 1}
          />
          <SealedRow
            label="Tops up to"
            value={shown(2, ranges ? pctRange(ranges.target_range_pct) : '—')}
            dots={collapsed >= 2}
          />
          <SealedRow label="Reserve" value={shown(3, `${amountStr || '0'} ${asset.symbol}`)} dots={collapsed >= 3} />
          <p className="text-[13px] text-muted">
            Mark {price(holding.mark)} · Liq{' '}
            <span className="text-red">{holding.liquidation === null ? '—' : price(holding.liquidation)}</span>, public
            to everyone.
          </p>
          <p className="border-t border-line pt-2.5 text-[13px] text-muted">
            Sealed on this device to OutLayer&apos;s enclave on NEAR. Nobody can read these, Ripcord included.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** Where setup stands once the guard is sealed: done steps ticked, the current one marked. */
function Progress({ phase, isolated }: { phase: Phase; isolated: boolean }) {
  const steps: [Phase, string][] = [
    ['sealing', 'Sealed'],
    ['save', 'Seal file saved'],
    ...(isolated ? ([['approve', 'Approved on Hyperliquid']] as [Phase, string][]) : []),
    ['fund', 'Reserve funded'],
  ];
  const order: Phase[] = ['edit', 'sealing', 'save', 'approve', 'fund', 'guarded'];
  const at = order.indexOf(phase);
  return (
    <ol aria-label="Setup" className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
      {steps.map(([p, label]) => {
        const i = order.indexOf(p);
        const done = i < at || (p === 'sealing' && at > 1) || phase === 'guarded';
        const current = p === phase;
        return (
          <li
            key={p}
            aria-current={current ? 'step' : undefined}
            className={`flex items-center gap-2 ${done ? 'text-text-2' : current ? 'font-medium text-text' : 'text-muted'}`}
          >
            <span
              aria-hidden="true"
              className={`grid h-4 w-4 place-items-center rounded-full border ${done ? 'border-green bg-green text-ground' : current ? 'border-amber' : 'border-line-3'}`}
            >
              {done && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M2 5.2 4.1 7.3 8 2.8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function SealedRow({ label, value, dots }: { label: string; value: string; dots: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line pt-2.5">
      <span className="text-muted">{label}</span>
      <span
        key={String(dots)}
        className={`seal-swap text-right font-medium tabular-nums ${dots ? 'font-mono tracking-[0.2em]' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function Page() {
  const { ready, session } = useSession();
  const { account, error } = useAccount(session);
  const params = useSearchParams();
  const coin = params.get('coin');
  const [local, setLocal] = useState<LocalGuard[]>([]);
  useEffect(() => setLocal(loadGuards()), []);

  if (!ready) return <div className="flex-1" />;
  if (!session) return <Connect />;
  if (error && !account)
    return (
      <p className="my-auto py-16 text-center text-text-2">
        Hyperliquid can&apos;t be read right now. Try again in a moment.
      </p>
    );
  if (!account)
    return <div aria-busy="true" className="h-[420px] animate-pulse rounded-[20px] border border-line bg-panel" />;
  const holding = account.holdings.find((h) => h.coin === coin);
  if (!holding) {
    if (account.holdings.length === 0)
      return <p className="my-auto py-16 text-center text-text-2">No open positions on this account.</p>;
    return <Chooser holdings={account.holdings} />;
  }
  const existing = guardOf(holding, guardsFor(session.address, session.kind === 'demo', local));
  if (existing) {
    return (
      <div className="my-auto flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">
          {holding.margin === 'cross'
            ? 'A guard already covers your cross positions.'
            : 'This position already has a guard.'}
        </h1>
        <Link href={`/guards/${existing.id}`} className={primaryBtn}>
          Open guard
        </Link>
      </div>
    );
  }
  return <Flow key={holding.coin} holding={holding} all={account.holdings} />;
}

export function NewGuard() {
  return (
    <SessionProvider>
      <AppShell>
        <Suspense fallback={<div className="flex-1" />}>
          <Page />
        </Suspense>
      </AppShell>
    </SessionProvider>
  );
}
