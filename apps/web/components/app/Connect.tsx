'use client';

import { useState } from 'react';
import { demoSession, useSession } from '../../lib/session';
import { connectWallet, isAddress } from '../../lib/wallet';
import { GuardCard } from '../GuardCard';
import { Card3D } from '../site/Card3D';
import { fieldCls, ghostBtn, primaryBtn } from './AppShell';

/** The way in. Connecting gives the app an address and nothing else: no signature, and positions are public anyway. */
export function Connect() {
  const { enter } = useSession();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wallet = async () => {
    setError(null);
    try {
      const a = await connectWallet();
      if (a) enter({ kind: 'wallet', address: a });
      else setError('No wallet found in this browser. Paste your address instead.');
    } catch {
      setError("Your wallet didn't connect. Try again, or paste your address.");
    }
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
          Ripcord reads your positions from Hyperliquid. Connecting signs nothing and moves nothing.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primaryBtn} onClick={wallet}>
            Connect wallet
          </button>
          <button type="button" className={ghostBtn} onClick={() => enter(demoSession)}>
            Try an example account
          </button>
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
