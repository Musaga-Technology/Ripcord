'use client';

// The steps after sealing, used by New guard and again by Guard when someone comes back to finish: the one approval an
// isolated position takes on Hyperliquid, and funding the reserve.
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  accountCommitment,
  commitment,
  createInput,
  fingerprint,
  ownerCommitment,
  type PreparedGuard,
  type SealContents,
} from '@ripcord/shared';
import { encode } from 'uqr';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSETS, sourcesFor } from '../../lib/assets';
import { DEMO_ARRIVES_MS, random, Refused, type Backend, type Deposit } from '../../lib/backend';
import { readAgents } from '../../lib/hl';
import type { TopupInput } from '../../lib/ownerActions';
import { approveAgent, sendFromHyperliquid } from '../../lib/wallet';
import { ghostBtn, primaryBtn } from './AppShell';
import { Turned, display } from '../Display';

export const assetOf = (reserve: string) => ASSETS.find((a) => a.reserve === reserve) ?? ASSETS[ASSETS.length - 1]!;

/** Sentences for a refusal: nothing upstream is ever shown raw (DESIGN §8.2). */
export function explain(e: unknown, doing: string): string {
  const m = e instanceof Refused ? e.message : '';
  if (m === 'not configured')
    return "This copy of Ripcord isn't connected to a guard yet. The simulation works without one.";
  if (m === 'too many requests') return 'Too many requests from here. Wait a minute and try again.';
  if (m.includes('private route') || m.includes('HTTP 503')) {
    return `The private route is down, so ${doing} has to wait. Nothing has moved. Try again soon.`;
  }
  return `Couldn't finish ${doing}. Nothing has moved. Try again.`;
}

export function Approve({
  contents,
  backend,
  isDemo,
  owner,
  onDone,
}: {
  contents: SealContents;
  backend: Backend;
  isDemo: boolean;
  owner: string;
  onDone(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = Number(BigInt(contents.settings.expires_at) / 1_000_000n);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isDemo) {
        await new Promise((r) => setTimeout(r, 1100));
        onDone();
        return;
      }
      // `create` is safe to repeat, and its answer names the agent, sealed to this device.
      const input = createInput(preparedHashes(contents), await backend.pubkey(), random);
      const { agent } = await backend.create(input, contents.receipt_secret);
      if (!agent) throw new Refused('no agent');
      const failed = await approveAgent(owner, agent, contents.agent_name ?? bytesToHex(random(4)), until);
      if (failed) {
        setError(failed);
        return;
      }
      const agents = await readAgents(owner);
      if (agents.some((a) => a.address.toLowerCase() === agent.toLowerCase())) onDone();
      else setError("Hyperliquid hasn't shown the approval yet. Try again in a moment.");
    } catch (e) {
      setError(
        e instanceof Refused ? explain(e, 'the approval') : "The approval wasn't signed. Try again when you're ready.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="step-in flex flex-col items-start gap-4">
      <h2 className={`${display} text-[36px] leading-[1.05] sm:text-[42px]`}>
        <Turned>One approval on Hyperliquid.</Turned>
      </h2>
      <p className="max-w-[34rem] text-[15px] text-text-2">
        A rescue reaches an isolated position through one key you approve. It can&apos;t withdraw or send your money,
        and the guard only uses it to add margin. Revoke it on Hyperliquid any time; it ends with the guard.
      </p>
      <p className="max-w-[34rem] text-[13px] text-muted">
        The key belongs to this guard&apos;s own wallet and never leaves OutLayer&apos;s keystore on NEAR.
      </p>
      <button type="button" className={primaryBtn} onClick={approve} disabled={busy}>
        {busy ? 'Waiting for your wallet…' : 'Approve on Hyperliquid'}
      </button>
      <p role="alert" className="min-h-6 text-[15px] text-red">
        {error}
      </p>
    </div>
  );
}

/** Rebuilds what `createInput` needs from a seal file: the hashes are recomputed, so a tampered copy is refused. */
export function preparedHashes(c: SealContents): PreparedGuard {
  const com = commitment(c.settings, c.salt);
  return {
    contents: c,
    commitment: com,
    owner_commitment: ownerCommitment(c.settings.owner, c.owner_salt),
    account_commitment: accountCommitment(c.settings.hl_address, c.settings.account_salt),
    fingerprint: fingerprint(com),
  };
}

function Qr({ text }: { text: string }) {
  const q = useMemo(() => encode(text, { ecc: 'M', border: 2 }), [text]);
  const cells: string[] = [];
  q.data.forEach((row, y) => row.forEach((on, x) => on && cells.push(`M${x} ${y}h1v1h-1z`)));
  return (
    <svg
      role="img"
      aria-label="QR code of the deposit address"
      viewBox={`0 0 ${q.size} ${q.size}`}
      className="h-[168px] w-[168px] shrink-0 rounded-[12px] bg-white"
      shapeRendering="crispEdges"
    >
      <path d={cells.join('')} fill="#0b0b0d" />
    </svg>
  );
}

export function Fund({
  contents,
  backend,
  isDemo,
  wallet,
  fallback,
  onFunded,
  topup = null,
}: {
  contents: SealContents;
  backend: Backend;
  isDemo: boolean;
  /** The connected wallet, which can sign a send from Hyperliquid; null for a pasted address. */
  wallet: string | null;
  /** The amount as first chosen, in words: shown in demo mode, where no price is quoted. */
  fallback: string;
  onFunded(): void;
  /** A signed top-up: its own address, and it has arrived once the reserve holds more than before. */
  topup?: TopupInput | null;
}) {
  const sources = sourcesFor(assetOf(contents.settings.reserve_asset));
  const [srcIx, setSrcIx] = useState(0);
  const asset = sources[srcIx] ?? sources[0]!;
  // From Hyperliquid, a connected wallet signs the send here, so nobody copies an address between apps.
  const inApp = !!asset.how && (isDemo || wallet !== null);
  const [sending, setSending] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  useEffect(() => {
    setSending('idle');
    setSendError(null);
  }, [asset]);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'address' | 'amount' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [arrived, setArrived] = useState(false);
  const done = useRef(onFunded);
  done.current = onFunded;
  // What the reserve held before this funding: a top-up has arrived once it holds more.
  const before = useRef<bigint | null>(topup ? null : 0n);

  useEffect(() => {
    if (!topup) return;
    backend
      .reserve(contents)
      .then((b) => (before.current = BigInt(b[contents.settings.reserve_asset] ?? '0')))
      .catch(() => (before.current = 0n));
  }, [backend, contents, topup]);

  useEffect(() => {
    let stop = false;
    setError(null);
    setDeposit(null);
    (topup ? backend.topup(contents, topup, asset.source) : backend.fund(contents, asset.source))
      .then((d) => !stop && setDeposit(d))
      .catch((e: unknown) => !stop && setError(explain(e, 'a deposit address')));
    return () => {
      stop = true;
    };
  }, [backend, contents, asset, attempt, topup]);

  useEffect(() => {
    if (!deposit) return;
    let stop = false;
    const look = async () => {
      try {
        const balances = await backend.reserve(contents);
        const held = balances[contents.settings.reserve_asset];
        if (!stop && held && before.current !== null && BigInt(held) > before.current) {
          stop = true;
          setArrived(true);
          setTimeout(() => done.current(), 1400);
        }
      } catch {
        // Keeps waiting: a missed look changes nothing.
      }
    };
    const t = setInterval(look, isDemo ? 1000 : 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [backend, contents, deposit, isDemo]);

  const forReserve =
    deposit && deposit.decimals > 0
      ? Number(deposit.amount) / 10 ** deposit.decimals
      : Number(fallback.replace(/,/g, ''));
  // What to send: the reserve, plus what the send itself carries (Hyperliquid: $1 for the transfer), in whole cents
  // from Hyperliquid.
  const total = forReserve + (asset.extra ?? 0);
  const exact = String(asset.how ? Math.ceil(total * 100 - 1e-6) / 100 : Math.round(total * 1e8) / 1e8);
  const amount = Number(exact).toLocaleString('en-US', { maximumFractionDigits: 8 });
  const reserveAmount = forReserve.toLocaleString('en-US', { maximumFractionDigits: 8 });

  const send = async () => {
    if (!deposit) return;
    setSendError(null);
    setSending('sending');
    if (isDemo) {
      await new Promise((r) => setTimeout(r, 900));
      setSending('sent');
      return;
    }
    try {
      const e = await sendFromHyperliquid(wallet as string, deposit.address, exact);
      setSendError(e);
      setSending(e ? 'idle' : 'sent');
    } catch {
      setSendError("Your wallet didn't sign. Try again, or send it yourself in Hyperliquid.");
      setSending('idle');
    }
  };

  const copy = async (what: 'address' | 'amount') => {
    if (!deposit) return;
    try {
      await navigator.clipboard.writeText(what === 'address' ? deposit.address : exact);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Both are selectable text.
    }
  };

  return (
    <div className="step-in flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className={`${display} text-[36px] leading-[1.05] sm:text-[42px]`}>
          <Turned>{topup ? 'Top up the reserve.' : 'Fund the reserve.'}</Turned>
        </h2>
        <p className="max-w-[34rem] text-[15px] text-text-2">
          {asset.extra
            ? `Send ${amount} ${asset.symbol} from ${asset.chain}: ${reserveAmount} for the reserve and $${asset.extra} for the transfer.`
            : `Send ${amount} ${asset.symbol} from ${asset.chain}.`}{' '}
          NEAR Intents carries it into a private balance held by this guard&apos;s own wallet, which can pay only your
          Hyperliquid account.
        </p>
      </div>
      {sources.length > 1 && (
        <div role="radiogroup" aria-label="Send from" className="flex w-fit gap-1 rounded-full border border-line p-1">
          {sources.map((s, i) => (
            <button
              key={s.source}
              type="button"
              role="radio"
              aria-checked={i === srcIx}
              onClick={() => setSrcIx(i)}
              className={`min-h-10 rounded-full px-4 text-[15px] transition-colors duration-[120ms] ${i === srcIx ? 'bg-text font-medium text-ground' : 'text-text-2 hover:text-text'}`}
            >
              From {s.chain}
            </button>
          ))}
        </div>
      )}
      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-[20px] border border-line bg-panel p-5">
          <p role="alert" className="text-[15px] text-red">
            {error}
          </p>
          <button type="button" className={ghostBtn} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : !deposit ? (
        <div aria-busy="true" className="h-[208px] animate-pulse rounded-[20px] border border-line bg-panel" />
      ) : (
        <>
          {inApp && (
            <div className="flex flex-col items-start gap-2">
              <button type="button" className={primaryBtn} disabled={sending !== 'idle' || arrived} onClick={send}>
                {sending === 'sending'
                  ? 'Waiting for your wallet…'
                  : sending === 'sent'
                    ? 'Sent from Hyperliquid'
                    : `Send ${amount} ${asset.symbol} from Hyperliquid`}
              </button>
              <p className="text-[13px] text-muted">
                {isDemo
                  ? 'In the simulation nothing is signed. For real, your wallet shows the amount and the address below before you sign.'
                  : 'Your wallet shows the amount and the address below before you sign. Ripcord never holds a key.'}
              </p>
              {sendError && (
                <p role="alert" className="text-[15px] text-red">
                  {sendError}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-5 rounded-[20px] border border-line bg-panel p-5">
            {/* A QR is for a phone wallet; a send from Hyperliquid happens in Hyperliquid itself. */}
            {!asset.how && <Qr text={deposit.address} />}
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
              <span className="text-[13px] text-muted">
                {isDemo
                  ? 'Example address, no funds needed'
                  : inApp
                    ? `Goes to this address on ${asset.chain}`
                    : `Send to this address on ${asset.chain}`}
              </span>
              <code className="break-all font-mono text-[15px] leading-relaxed text-text">{deposit.address}</code>
              <span className="flex flex-wrap items-baseline gap-x-2 text-[15px] tabular-nums">
                <span className="text-muted">Amount</span>
                <span className="font-semibold">
                  {amount} {asset.symbol}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${ghostBtn} min-h-11 px-4 text-[13px]`}
                  onClick={() => copy('address')}
                >
                  {copied === 'address' ? 'Copied' : 'Copy address'}
                </button>
                <button
                  type="button"
                  className={`${ghostBtn} min-h-11 px-4 text-[13px]`}
                  onClick={() => copy('amount')}
                >
                  {copied === 'amount' ? 'Copied' : 'Copy amount'}
                </button>
              </span>
              <span className="text-[13px] text-muted">
                {asset.how
                  ? `${inApp ? `Or send it yourself: ${asset.how[0]!.toLowerCase()}${asset.how.slice(1)}` : asset.how} `
                  : ''}
                Send only {asset.symbol} on {asset.chain} to this address.
              </span>
              {asset.note && <span className="text-[13px] text-muted">{asset.note}</span>}
            </div>
          </div>
        </>
      )}
      {deposit && (
        <p aria-live="polite" className="flex items-center gap-2 text-[15px] text-text-2">
          {arrived ? (
            <>
              <span className="h-[7px] w-[7px] rounded-full bg-green" />
              {topup ? 'Top-up received' : 'Reserve received'}: {reserveAmount} {asset.symbol}.
            </>
          ) : (
            <>
              <span className="chip-pulse h-[7px] w-[7px] rounded-full bg-amber" />
              Waiting for reserve. {isDemo ? `The example arrives in ${DEMO_ARRIVES_MS / 1000} seconds.` : asset.wait}
            </>
          )}
        </p>
      )}
    </div>
  );
}
