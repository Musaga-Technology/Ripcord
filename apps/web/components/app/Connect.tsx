'use client';

import { useState } from 'react';
import { demoSession, useSession } from '../../lib/session';
import { connectWallet, isAddress, wallets, type WalletChoice } from '../../lib/wallet';
import { GuardCard } from '../GuardCard';
import { Card3D } from '../site/Card3D';
import { fieldCls, ghostBtn, primaryBtn } from './AppShell';

/** The way in. Connecting gives the app an address and nothing else: no signature, and positions are public anyway. */
export function Connect() {
  const { enter } = useSession();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [choices, setChoices] = useState<WalletChoice[] | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  const use = async (w: WalletChoice) => {
    setError(null);
    setWaiting(w.name);
    setSlow(false);
    const t = setTimeout(() => setSlow(true), 8000);
    try {
      const a = await connectWallet(w);
      if (a) enter({ kind: 'wallet', address: a });
      else setError("That wallet didn't share an account. Try another, or paste your address.");
    } catch {
      setError("Your wallet didn't connect. Try again, pick another, or paste your address.");
    } finally {
      clearTimeout(t);
      setWaiting(null);
    }
  };

  // Several wallets can be installed, and not every one signs for Ethereum: with more than one, the person picks.
  const wallet = async () => {
    setError(null);
    const list = await wallets();
    if (list.length === 0) setError('No wallet found in this browser. Paste your address instead.');
    else if (list.length === 1) void use(list[0]!);
    else setChoices(list);
  };

  const paste = (e: React.FormEvent) => {
    e.preventDefault();
    const a = address.trim();
    if (isAddress(a)) enter({ kind: 'address', address: a.toLowerCase() });
    else setError('That isn’t a Hyperliquid address. It starts with 0x and has 42 characters.');
  };

  return (
    <div className="my-auto grid items-center gap-12 py-6 lg:grid-cols-[1fr_1fr] lg:gap-20">
      <div className="flex max-w-[30rem] flex-col gap-6">
        <h1 className="text-[48px] font-semibold leading-[0.95] tracking-[-0.04em] sm:text-[76px]">
          Guard a position.
        </h1>
        <p className="text-[17px] text-text-2">
          Ripcord reads your positions from Hyperliquid. Connecting signs nothing and moves nothing. Your guard then
          runs on NEAR: its line sealed in an enclave, its reserve in a balance nobody can see.
        </p>
        <div className="flex flex-col items-start gap-3">
          <button type="button" className={primaryBtn} onClick={() => void wallet()} disabled={waiting !== null}>
            {waiting ? `Waiting for ${waiting}…` : 'Connect wallet'}
          </button>
          {choices && !waiting && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-muted">Pick the wallet that holds your Hyperliquid account</span>
              <div className="flex flex-wrap gap-2">
                {choices.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => void use(w)}
                    className={`${ghostBtn} min-h-11 gap-2 px-4 text-[14px]`}
                  >
                    {w.icon && <img src={w.icon} alt="" width={20} height={20} className="rounded-[5px]" />}
                    {w.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {waiting && slow && (
            <p className="max-w-[30rem] text-[13px] text-muted">
              Look for {waiting}&apos;s window; it may be behind this one. If nothing opened, reload and pick another
              wallet.
            </p>
          )}
        </div>
        <form onSubmit={paste} className="flex flex-col gap-2 border-t border-line pt-5">
          <label htmlFor="address" className="text-[13px] text-muted">
            Or paste your Hyperliquid address
          </label>
          <div className="flex gap-2">
            <input
              id="address"
              className={`${fieldCls} font-mono text-[13px]`}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setError(null);
              }}
            />
            <button type="submit" className={`${ghostBtn} shrink-0 px-5`} disabled={!address.trim()}>
              Read it
            </button>
          </div>
        </form>
        <p role="alert" className="min-h-6 text-[15px] text-red">
          {error}
        </p>
        <section
          aria-label="Simulation"
          className="flex flex-col items-start gap-3 rounded-[20px] border border-line bg-panel p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-[17px] font-semibold">Not ready to connect? Try a simulation.</h2>
            <p className="text-[15px] text-text-2">
              An example account with simulated prices and money. Guard a position, then crash the market and watch the
              rescue land.
            </p>
          </div>
          <button type="button" className={ghostBtn} onClick={() => enter(demoSession)}>
            Try a simulation
          </button>
        </section>
      </div>
      <div className="mx-auto w-full max-w-[460px]">
        <Card3D>
          <GuardCard
            label="Your position"
            distance="—"
            sub="from liquidation"
            fingerprint="•••• •••• ···· ••••"
            commitment="7f3a91c2e04b5d18a6f2c3b9d07e41a2b6c8d9e0f1a2b3c4d5e6f708192ac91e"
            state="draft"
            status="Not sealed"
            reserve="••••••"
            print
            depth
          />
        </Card3D>
      </div>
    </div>
  );
}
