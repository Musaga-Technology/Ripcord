'use client';

import { fingerprint, isSealFile, readSealFile, type SealFile } from '@ripcord/shared';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { keepOpened, saveGuard } from '../../lib/store';
import { fieldCls, ghostBtn } from './AppShell';

/** A guard from another device, or after this browser forgot: its seal file brings it back, opened here and nowhere else. */
export function OpenSeal({ isDemo, onOpened }: { isDemo: boolean; onOpened(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<SealFile | null>(null);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const v: unknown = JSON.parse(await f.text());
      if (!isSealFile(v)) throw new Error('not a seal file');
      setFile(v);
    } catch {
      setError("That isn't a seal file.");
    }
  };

  const open = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    try {
      const c = await readSealFile(file, pass);
      keepOpened(c);
      const coin = c.settings.isolated?.coin ?? 'Cross';
      saveGuard({
        id: c.guard_id,
        commitment: file.commitment,
        fingerprint: fingerprint(file.commitment),
        address: c.settings.hl_address,
        coin,
        label: c.settings.isolated ? `${coin} isolated` : 'Cross margin',
        margin: c.settings.isolated ? 'isolated' : 'cross',
        demo: isDemo,
        funded: true,
        approved: true,
        file,
        created_at: Date.now(),
      });
      onOpened();
      setFile(null);
      setPass('');
    } catch {
      setError("That passphrase doesn't open this seal file.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={pick}
      />
      {file ? (
        <form onSubmit={open} className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            aria-label="Passphrase"
            placeholder="Passphrase"
            className={`${fieldCls} w-[220px]`}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button type="submit" className={`${ghostBtn} px-4`} disabled={!pass}>
            Open
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="inline-flex min-h-11 items-center underline decoration-line-3 underline-offset-4 hover:text-text"
          onClick={() => input.current?.click()}
        >
          Open a seal file
        </button>
      )}
      {error && (
        <span role="alert" className="text-red">
          {error}
        </span>
      )}
    </div>
  );
}
