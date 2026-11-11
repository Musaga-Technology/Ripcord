// This device's guards. Sealed settings live only in the encrypted seal file; the rest is what the card shows, and the
// account it guards, which never leaves this browser. Storage can be blocked, so nothing here throws.
import type { SealContents, SealFile } from '@ripcord/shared';

export interface LocalGuard {
  id: string;
  commitment: string;
  fingerprint: string;
  address: string;
  coin: string;
  label: string;
  margin: 'cross' | 'isolated';
  demo: boolean;
  /** Reserve seen in the guard's wallet; an isolated guard's agent approved on Hyperliquid. */
  funded: boolean;
  approved: boolean;
  /** What the owner's top-ups added to the reserve, in US dollars (shown with the sealed budget). */
  added_usd?: number;
  file: SealFile;
  created_at: number;
}

const KEY = 'ripcord-guards';

export function loadGuards(): LocalGuard[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LocalGuard[];
  } catch {
    return [];
  }
}

function save(list: LocalGuard[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not remembered on this device; the seal file still holds everything.
  }
}

export function saveGuard(g: LocalGuard): void {
  save([g, ...loadGuards().filter((x) => x.id !== g.id)]);
}

/** Forgets the guards made in a simulation, so the next one starts from the example account as it was. */
export function clearSimulation(): void {
  save(loadGuards().filter((g) => !g.demo));
}

export function patchGuard(id: string, patch: Partial<LocalGuard>): void {
  save(loadGuards().map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

// Opened seal files, and the keys their passphrases gave, for this page's life only: a change to a guard (a new
// range) rewrites its seal file without asking for the passphrase again.
const opened = new Map<string, SealContents>();
const keys = new Map<string, Uint8Array>();
export const openedSeal = (id: string) => opened.get(id) ?? null;
export const openedKey = (id: string) => keys.get(id) ?? null;
export function keepOpened(c: SealContents, key?: Uint8Array): void {
  opened.set(c.guard_id, c);
  if (key) keys.set(c.guard_id, key);
}

/** Saves the seal file and returns the name it was saved under. */
export function downloadSealFile(g: Pick<LocalGuard, 'file' | 'fingerprint'>): string {
  const name = `ripcord-seal-${g.fingerprint.replace(/[^0-9A-F]/g, '').toLowerCase()}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(g.file, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
