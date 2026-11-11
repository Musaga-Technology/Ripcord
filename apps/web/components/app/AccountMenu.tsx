'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../lib/session';

/** The account pill: copy the address, see it on Hyperliquid, or disconnect, in a menu rather than on one click. */
export function AccountMenu({ session, onLeave }: { session: Session; onLeave(): void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const short = `${session.address.slice(0, 6)}…${session.address.slice(-4)}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(session.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // The address is shown in full in the menu, as selectable text.
    }
  };

  const item =
    'flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[14px] transition-colors duration-[120ms] hover:bg-line';

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="min-h-10 rounded-full border border-line-3 px-3 font-mono text-[13px] text-text-2 transition-colors duration-[120ms] hover:border-muted"
      >
        {short}
      </button>
      {open && (
        <div
          role="menu"
          className="step-in absolute right-0 top-[calc(100%+8px)] z-50 flex w-[260px] flex-col gap-1 rounded-[16px] border border-line bg-panel p-2 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.6)]"
        >
          <span className="break-all px-3 pb-1 pt-2 font-mono text-[12px] text-muted">{session.address}</span>
          <button type="button" role="menuitem" className={item} onClick={copy}>
            {copied ? 'Copied' : 'Copy address'}
          </button>
          {session.kind !== 'demo' && (
            <a
              role="menuitem"
              className={item}
              href={`https://app.hyperliquid.xyz/explorer/address/${session.address}`}
              target="_blank"
              rel="noreferrer"
            >
              View on Hyperliquid
            </a>
          )}
          <button
            type="button"
            role="menuitem"
            className={`${item} text-red`}
            onClick={() => {
              setOpen(false);
              onLeave();
            }}
          >
            {session.kind === 'demo' ? 'Leave simulation' : 'Disconnect'}
          </button>
        </div>
      )}
    </div>
  );
}
