'use client';

// "Say it in your words": the trader types what they want and the guard's settings below fill in. The words are
// encrypted on this device for NEAR AI's enclave; the settings stay editable and nothing is sealed until they press Seal.
import { useState, type FormEvent } from 'react';
import { askCopilot, CopilotError, type Intent } from '../../lib/copilot';
import type { Holding } from '../../lib/hl';
import { fieldCls, ghostBtn } from './AppShell';

export function PlainWords({
  holding,
  disabled,
  onIntent,
}: {
  holding: Holding;
  disabled: boolean;
  /** Applies the intent to the form and returns the read-back sentence. */
  onIntent(i: Intent): string;
}) {
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [readBack, setReadBack] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!words.trim() || busy) return;
    setBusy(true);
    setError(null);
    setReadBack(null);
    try {
      const { intent, modelKey } = await askCopilot(holding, words.trim());
      setReadBack(onIntent(intent));
      setKey(modelKey);
    } catch (err) {
      setError(err instanceof CopilotError ? err.message : "NEAR AI didn't answer. Set it below instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="In your words" className="flex flex-col gap-3">
      <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="What should this guard do?"
          className={fieldCls}
          placeholder={`Keep my ${holding.coin} ${holding.side.toLowerCase()} alive through a 25% drop, with BTC`}
          value={words}
          maxLength={500}
          disabled={disabled || busy}
          onChange={(e) => setWords(e.target.value)}
        />
        <button type="submit" className={`${ghostBtn} shrink-0`} disabled={disabled || busy || !words.trim()}>
          {busy ? 'Reading…' : 'Set it up'}
        </button>
      </form>
      <p aria-live="polite" className="text-[13px] text-muted">
        {error ? (
          <span className="text-red">{error}</span>
        ) : readBack ? (
          <>
            <span className="text-[15px] text-text">{readBack}</span> Check it below, then seal.
          </>
        ) : busy ? (
          "Reading it inside NEAR AI's enclave…"
        ) : (
          'Or set it below. Your words are encrypted on this device for NEAR AI’s enclave; Ripcord only passes them on.'
        )}
        {key && !error && <span className="block pt-1">Answered inside NEAR AI’s enclave, key {key.slice(0, 8)}…</span>}
      </p>
    </section>
  );
}
