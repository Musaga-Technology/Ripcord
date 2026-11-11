// The owner's own actions on a real guard, signed in the browser with the owner key from the opened seal file
// (NEP-413 for the registry). The enclave only submits them: the registry checks a freeze, and the enclave checks a
// close against the owner key it holds sealed, so nobody else can freeze or close a guard.
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { closeMessage, freezeMessage, nep413Hash, type SealContents } from '@ripcord/shared';
import { REGISTRY } from './near';

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
