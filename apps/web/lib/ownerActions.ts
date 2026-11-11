// The owner's own actions on a real guard, signed in the browser with the owner key from the opened seal file
// (NEP-413 for the registry). The registry checks a freeze; the enclave checks a close, a top-up and a new range
// against the owner key it holds sealed, so nobody else can change a guard. A top-up's amount and a new range are
// sealed to the enclave, so Ripcord's servers relay them unread.
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  closeMessage,
  commitment,
  freezeMessage,
  nep413Hash,
  presetRanges,
  resealMessage,
  seal,
  topupDigest,
  topupMessage,
  type GuardSettings,
  type Preset,
  type SealContents,
} from '@ripcord/shared';
import { REGISTRY } from './near';

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const sealTo = (enclavePk: string, v: unknown, guardId: string) =>
  bytesToHex(seal(hexToBytes(enclavePk), utf8ToBytes(JSON.stringify(v)), guardId, random));

/** A fresh nonce in the registry's alphabet ([A-Za-z0-9_-], 1–64 characters). */
const nonce = () => bytesToHex(crypto.getRandomValues(new Uint8Array(12)));

const sign = (c: SealContents, message: string, n: string) =>
  bytesToHex(ed25519.sign(nep413Hash(message, n, REGISTRY), hexToBytes(c.owner_secret)));

export interface FreezeInput {
  action: 'freeze';
  guard_id: string;
  owner: string;
  owner_salt: string;
  sig: string;
  nonce: string;
  frozen: boolean;
}

export function signFreeze(c: SealContents, frozen: boolean): FreezeInput {
  const n = nonce();
  return {
    action: 'freeze',
    guard_id: c.guard_id,
    owner: c.settings.owner,
    owner_salt: c.owner_salt,
    sig: sign(c, freezeMessage(c.guard_id, n, frozen), n),
    nonce: n,
    frozen,
  };
}

export interface CloseInput {
  action: 'close';
  guard_id: string;
  sig: string;
  nonce: string;
}

/** Closes the guard and pays what is left to the owner's own Hyperliquid account: the only place it can go. */
export function signClose(c: SealContents): CloseInput {
  const n = nonce();
  return {
    action: 'close',
    guard_id: c.guard_id,
    sig: sign(c, closeMessage(c.guard_id, 'hypercore', c.settings.hl_address, n), n),
    nonce: n,
  };
}

export interface TopupInput {
  action: 'topup';
  guard_id: string;
  enc_amount: string;
  owner_salt: string;
  sig: string;
  nonce: string;
}

/** Signs a top-up of `usd` once; each source the owner picks after it gets its own address, and the budget rises once. */
export function signTopup(c: SealContents, usd: number, enclavePk: string): TopupInput {
  const cents = Math.round(usd * 100);
  const salt = bytesToHex(random(16));
  const n = nonce();
  return {
    action: 'topup',
    guard_id: c.guard_id,
    enc_amount: sealTo(enclavePk, { cents, salt }, c.guard_id),
    owner_salt: c.owner_salt,
    sig: sign(c, topupMessage(c.guard_id, topupDigest(c.guard_id, cents, salt), n), n),
    nonce: n,
  };
}

/** The settings with a preset's range drawn from today's distance to liquidation; null when it doesn't fit. */
export function withRange(s: GuardSettings, preset: Preset, distance: number): GuardSettings | null {
  const r = presetRanges(preset, distance);
  return r ? { ...s, preset, line_range_pct: r.line_range_pct, target_range_pct: r.target_range_pct } : null;
}

export interface ResealInput {
  action: 'reseal';
  guard_id: string;
  enc_range: string;
  commitment: string;
  owner_salt: string;
  sig: string;
  nonce: string;
}

/** Signs the new settings' fingerprint and seals their range to the enclave. */
export function signReseal(c: SealContents, next: GuardSettings, enclavePk: string): ResealInput {
  const n = nonce();
  const fingerprint = commitment(next, c.salt);
  const { preset, line_range_pct, target_range_pct } = next;
  return {
    action: 'reseal',
    guard_id: c.guard_id,
    enc_range: sealTo(enclavePk, { preset, line_range_pct, target_range_pct }, c.guard_id),
    commitment: fingerprint,
    owner_salt: c.owner_salt,
    sig: sign(c, resealMessage(c.guard_id, fingerprint, n), n),
    nonce: n,
  };
}

/** The seal's contents after a new range: the old one is kept with the epoch the new one's first line is drawn in. */
export function resealed(c: SealContents, next: GuardSettings, fromEpoch: number): SealContents {
  const earlier = [
    ...(c.earlier ?? []),
    {
      until_epoch: fromEpoch,
      line_range_pct: c.settings.line_range_pct,
      target_range_pct: c.settings.target_range_pct,
    },
  ];
  return { ...c, settings: next, earlier };
}
