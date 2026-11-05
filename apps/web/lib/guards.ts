// The guards shown for an account: this device's, and in demo mode the example ones.
import { DEMO_GUARDS } from '@ripcord/shared/mock';
import type { Holding } from './hl';
import type { LocalGuard } from './store';

export interface ShownGuard {
  id: string;
  commitment: string;
  fingerprint: string;
  coin: string;
  label: string;
  margin: 'cross' | 'isolated';
  /** Example guards in demo mode show their sealed settings in words; real ones open with the seal file. */
  example: { reserve: string; range: string; target: string; reserveX: number } | null;
  local: LocalGuard | null;
  state: 'approval' | 'waiting' | 'guarded';
}

export const stateOf = (g: LocalGuard): ShownGuard['state'] =>
  g.margin === 'isolated' && !g.approved ? 'approval' : g.funded ? 'guarded' : 'waiting';

export const STATE_TEXT: Record<ShownGuard['state'], string> = {
  approval: 'Needs approval',
  waiting: 'Waiting for reserve',
  guarded: 'Guarded',
};

/** The example account's guards: its one cross guard, and the isolated HYPE position's. */
const EXAMPLES = DEMO_GUARDS.filter((g) => g.coin !== 'BTC').map((g): ShownGuard => ({
  id: g.guardId,
  commitment: g.commitment,
  fingerprint: g.fingerprint,
  coin: g.coin,
  label: g.label,
  margin: g.settings.isolated ? 'isolated' : 'cross',
  example: { ...g.sealed, reserveX: 1.4 },
  local: null,
  state: 'guarded',
}));

export function guardsFor(address: string, isDemo: boolean, local: LocalGuard[]): ShownGuard[] {
  const mine = local
    .filter((g) => g.demo === isDemo && g.address === address.toLowerCase())
    .map((g): ShownGuard => ({
      id: g.id,
      commitment: g.commitment,
      fingerprint: g.fingerprint,
      coin: g.coin,
      label: g.label,
      margin: g.margin,
      example: null,
      local: g,
      state: stateOf(g),
    }));
  return isDemo ? [...mine, ...EXAMPLES] : mine;
}

/** A cross guard covers every cross position on the account, since they share one margin balance. */
export function guardOf(h: Holding, guards: ShownGuard[]): ShownGuard | null {
  return (
    guards.find((g) => (h.margin === 'cross' ? g.margin === 'cross' : g.margin === 'isolated' && g.coin === h.coin)) ??
    null
  );
}

/** What the guard watches: the nearest cross position, or the isolated position itself (`guardDistance`). */
export function watchedDistance(h: Holding, all: Holding[]): number | null {
  if (h.margin === 'isolated') return h.distance;
  const cross = all.filter((x) => x.margin === 'cross' && x.distance !== null).map((x) => x.distance as number);
  return cross.length ? Math.min(...cross) : null;
}

export const labelOf = (h: Holding) =>
  `${h.coin} ${h.side.toLowerCase()} · ${h.leverage}×${h.margin === 'isolated' ? ' isolated' : ''}`;
