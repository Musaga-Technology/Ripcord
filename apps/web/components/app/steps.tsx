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
        Isolated margin, so this guard needs one approval on Hyperliquid. Its code only adds margin. You can revoke it
        there at any time, and it ends with the guard.
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
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
        if (!stop && held && BigInt(held) > 0n) done.current();
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

  const amount =
    deposit && deposit.decimals > 0
      ? (Number(deposit.amount) / 10 ** deposit.decimals).toLocaleString('en-US', { maximumFractionDigits: 8 })
      : fallback;

  const copy = async () => {
    if (!deposit) return;
    try {
      await navigator.clipboard.writeText(deposit.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The address is selectable text.
    }
  };

  return (
    <div className="step-in flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">Fund the reserve.</h2>
        <p className="max-w-[34rem] text-[15px] text-text-2">
          Send {amount} {asset.symbol} from {asset.chain}. It lands in a confidential balance, so its size stays
          private.
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
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-3">
            <span className="text-[13px] text-muted">
              {isDemo ? 'Example address, no funds needed' : `Your ${asset.chain} deposit address`}
            </span>
            <code className="break-all font-mono text-[13px] leading-relaxed text-text-2">{deposit.address}</code>
            <button type="button" className={`${ghostBtn} w-fit min-h-10 px-4 text-[13px]`} onClick={copy}>
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
        </div>
      )}
      {deposit && (
        <p aria-live="polite" className="flex items-center gap-2 text-[15px] text-text-2">
          <span className="chip-pulse h-[7px] w-[7px] rounded-full bg-amber" />
          Waiting for reserve. {isDemo ? `The example arrives in ${DEMO_ARRIVES_MS / 1000} seconds.` : asset.wait}
        </p>
      )}
    </div>
  );
}
