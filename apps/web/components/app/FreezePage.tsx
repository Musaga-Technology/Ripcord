'use client';

// Freeze from anywhere: a guard that a NEAR wallet signs for can be frozen with that wallet alone, from any device,
// with no seal file. The wallet makes the owner's salt again (its signature of a fixed message), the registry lists
// the guards behind that owner's hash, and the wallet sends the freeze to the registry itself, so nothing of
// Ripcord's is involved.
import { freezeMessage, ownerCommitment } from '@ripcord/shared';
import Link from 'next/link';
import { useState } from 'react';
import { readFrozen, readOwnerGuards } from '../../lib/backend';
import { EXPLORER, NETWORK_NAME } from '../../lib/near';
import { connectNearOwner, freezeFromWallet, type NearOwner } from '../../lib/nearWallet';
import { nonce } from '../../lib/ownerActions';
import { SessionProvider } from '../../lib/session';
import { AppShell, ghostBtn, primaryBtn } from './AppShell';
import { Turned, display } from '../Display';

interface Row {
  id: string;
  status: string;
  frozen: boolean | null;
  tx: string | null;
}

const said = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? `${e.message[0]!.toUpperCase()}${e.message.slice(1)}.` : fallback;

function Freeze() {
  const [owner, setOwner] = useState<NearOwner | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const o = await connectNearOwner();
      const guards = (await readOwnerGuards(ownerCommitment(o.key, o.salt))) ?? [];
      const open = guards.filter((g) => g.status !== 'Closed');
      const frozen = await Promise.all(open.map((g) => readFrozen(g.guard_id).catch(() => null)));
      setOwner(o);
      setRows(open.map((g, i) => ({ id: g.guard_id, status: g.status, frozen: frozen[i] ?? null, tx: null })));
    } catch (e) {
      setError(said(e, "The wallet didn't connect."));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (r: Row) => {
    if (!owner) return;
    const freeze = !r.frozen;
    setBusy(r.id);
    setError(null);
    try {
      const n = nonce();
      const tx = await freezeFromWallet(owner, r.id, freeze, freezeMessage(r.id, n, freeze), n);
      const frozen = await readFrozen(r.id).catch(() => null);
      setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, frozen: frozen ?? freeze, tx } : x)) ?? null);
    } catch (e) {
      setError(said(e, "That didn't go through. Try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 py-6">
      <header className="flex flex-col gap-3">
        <h1 className={`${display} text-[40px] leading-[1.02] sm:text-[52px]`}>
          <Turned>Freeze with your NEAR wallet.</Turned>
        </h1>
        <p className="max-w-[34rem] text-[17px] text-text-2">
          Lost your device or your seal file? If your NEAR wallet signs for a guard, it can freeze the reserve from
          here, straight on {NETWORK_NAME}: nothing of Ripcord&apos;s is involved. While it&apos;s frozen, nothing
          leaves the reserve, rescues included.
        </p>
      </header>

      {!owner ? (
        <div className="flex flex-col items-start gap-3">
          <button type="button" className={primaryBtn} disabled={busy === 'connect'} onClick={() => void connect()}>
            {busy === 'connect' ? 'Waiting for your wallet…' : 'Connect NEAR wallet'}
          </button>
          <p className="max-w-[34rem] text-[13px] text-muted">
            Your wallet signs one message, the same on every device, which finds your guards by their fingerprints.
            Nothing is sent until you freeze.
          </p>
        </div>
      ) : (
        <section aria-label="Your guards" className="overflow-hidden rounded-[20px] border border-line bg-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-4">
            <h2 className="text-[17px] font-semibold">Guards that sign with {owner.account}</h2>
          </div>
          {rows && rows.length > 0 ? (
            <ul>
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 first:border-t-0"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[15px]">{r.id}</span>
                    <span className="flex items-center gap-2 text-[13px] text-muted">
                      <span className={`h-[7px] w-[7px] rounded-full ${r.frozen ? 'bg-muted' : 'bg-green'}`} />
                      {r.frozen
                        ? 'Frozen: nothing leaves the reserve'
                        : r.status === 'Pending'
                          ? 'Waiting for its first check'
                          : 'Guarding'}
                      {r.tx && (
                        <a
                          href={`${EXPLORER}/txns/${r.tx}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-line-3 underline-offset-4 hover:text-text"
                        >
                          on {NETWORK_NAME}
                        </a>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={r.frozen ? ghostBtn : primaryBtn}
                    disabled={busy !== null}
                    onClick={() => void toggle(r)}
                  >
                    {busy === r.id ? 'Signing…' : r.frozen ? 'Unfreeze' : 'Freeze'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-3 px-5 py-5">
              <p className="text-text-2">
                No guard signs with {owner.account}. A guard whose seal file signs for it is frozen from its own page,
                with the seal file.
              </p>
              <Link
                href="/guards"
                className="inline-flex min-h-11 items-center text-[15px] underline decoration-line-3 underline-offset-4 hover:text-text"
              >
                Go to your guards
              </Link>
            </div>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="text-[15px] text-red">
          {error}
        </p>
      )}
      {owner && (
        <button type="button" className={`${ghostBtn} w-fit`} onClick={() => void connect()} disabled={busy !== null}>
          Use another wallet
        </button>
      )}
    </div>
  );
}

export function FreezeView() {
  return (
    <SessionProvider>
      <AppShell>
        <Freeze />
      </AppShell>
    </SessionProvider>
  );
}
