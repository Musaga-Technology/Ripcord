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
import { ASSETS } from '../../lib/assets';
import { DEMO_ARRIVES_MS, random, Refused, type Backend, type Deposit } from '../../lib/backend';
import { readAgents } from '../../lib/hl';
import { approveAgent } from '../../lib/wallet';
import { ghostBtn, primaryBtn } from './AppShell';

export const assetOf = (reserve: string) => ASSETS.find((a) => a.reserve === reserve) ?? ASSETS[ASSETS.length - 1]!;

/** Sentences for a refusal: nothing upstream is ever shown raw (DESIGN §8.2). */
export function explain(e: unknown, doing: string): string {
  const m = e instanceof Refused ? e.message : '';
  if (m === 'not configured')
    return "This copy of Ripcord isn't connected to a guard yet. The example account works without one.";
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
      <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">One approval on Hyperliquid.</h2>
      <p className="max-w-[34rem] text-[15px] text-text-2">
        Isolated margin, so this guard needs one approval on Hyperliquid. The key you approve belongs to this
        guard&apos;s own wallet and never leaves OutLayer&apos;s keystore on NEAR; its code only adds margin. You can
        revoke it on Hyperliquid at any time, and it ends with the guard.
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
  fallback,
  onFunded,
}: {
  contents: SealContents;
  backend: Backend;
  isDemo: boolean;
  /** The amount as first chosen, in words: shown in demo mode, where no price is quoted. */
  fallback: string;
  onFunded(): void;
}) {
  const asset = assetOf(contents.settings.reserve_asset);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'address' | 'amount' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [arrived, setArrived] = useState(false);
  const done = useRef(onFunded);
  done.current = onFunded;

  useEffect(() => {
    let stop = false;
    setError(null);
    setDeposit(null);
    backend
      .fund(contents, asset.source)
      .then((d) => !stop && setDeposit(d))
      .catch((e: unknown) => !stop && setError(explain(e, 'a deposit address')));
    return () => {
      stop = true;
    };
  }, [backend, contents, asset, attempt]);

  useEffect(() => {
    if (!deposit) return;
    let stop = false;
    const look = async () => {
      try {
        const balances = await backend.reserve(contents);
        const held = balances[contents.settings.reserve_asset];
        if (!stop && held && BigInt(held) > 0n) {
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

  const exact =
    deposit && deposit.decimals > 0
      ? String(Number(deposit.amount) / 10 ** deposit.decimals)
      : fallback.replace(/,/g, '');
  const amount = Number(exact).toLocaleString('en-US', { maximumFractionDigits: 8 });

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
        <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">Fund the reserve.</h2>
        <p className="max-w-[34rem] text-[15px] text-text-2">
          Send {amount} {asset.symbol} from {asset.chain}. NEAR Intents carries it into a NEAR Confidential Intents
          balance held by this guard&apos;s own wallet, so its size stays private and it can pay only your Hyperliquid
          account.
        </p>
      </div>
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
        <div className="flex flex-wrap items-center gap-5 rounded-[20px] border border-line bg-panel p-5">
          <Qr text={deposit.address} />
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
            <span className="text-[13px] text-muted">
              {isDemo ? 'Example address, no funds needed' : `Your ${asset.chain} deposit address`}
            </span>
            <code className="break-all font-mono text-[15px] leading-relaxed text-text">{deposit.address}</code>
            <span className="flex flex-wrap items-baseline gap-x-2 text-[15px] tabular-nums">
              <span className="text-muted">Amount</span>
              <span className="font-semibold">
                {amount} {asset.symbol}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              <button type="button" className={`${ghostBtn} min-h-11 px-4 text-[13px]`} onClick={() => copy('address')}>
                {copied === 'address' ? 'Copied' : 'Copy address'}
              </button>
              <button type="button" className={`${ghostBtn} min-h-11 px-4 text-[13px]`} onClick={() => copy('amount')}>
                {copied === 'amount' ? 'Copied' : 'Copy amount'}
              </button>
            </span>
            <span className="text-[13px] text-muted">
              Send only {asset.symbol} on {asset.chain} to this address.
            </span>
          </div>
        </div>
      )}
      {deposit && (
        <p aria-live="polite" className="flex items-center gap-2 text-[15px] text-text-2">
          {arrived ? (
            <>
              <span className="h-[7px] w-[7px] rounded-full bg-green" />
              Reserve received: {amount} {asset.symbol}.
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
