// Hashes that let the public registry hold a guard without holding its owner or account (docs/SPEC.md §1).
// Salts are 64 lowercase hex characters; ‖ joins UTF-8 text. Mirrors checker/src/commitment.rs.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonical, type Json } from './canonical';
import type { GuardSettings } from './types';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ED25519 = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

const sha256Hex = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

function needSalt(salt: string): void {
  if (!HEX64.test(salt)) throw new Error('salt must be 64 lowercase hex characters');
}

export function commitment(settings: GuardSettings, salt: string): string {
  needSalt(salt);
  return sha256Hex(canonical(settings as unknown as Json) + salt);
}

export function normalizeOwner(owner: string): string {
  if (ADDRESS.test(owner)) return owner.toLowerCase();
  if (ED25519.test(owner)) return owner;
  throw new Error('owner must be an EVM address or ed25519:<base58>');
}

/** sha256 of the owner's signature over "ripcord:owner-salt:v1": deterministic, so the app finds an owner's guards. */
export function ownerSalt(signatureHex: string): string {
  const sig = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  return bytesToHex(sha256(hexToBytes(sig)));
}

export function ownerCommitment(owner: string, salt: string): string {
  needSalt(salt);
  return sha256Hex(normalizeOwner(owner) + salt);
}

export function accountCommitment(hlAddress: string, salt: string): string {
  needSalt(salt);
  if (!ADDRESS.test(hlAddress)) throw new Error('hl_address must be an EVM address');
  return sha256Hex(hlAddress.toLowerCase() + salt);
}

/** As printed on the card: first 4 bytes and last 2 bytes of the commitment. */
export function fingerprint(c: string): string {
  const u = c.toUpperCase();
  return `${u.slice(0, 4)} ${u.slice(4, 8)} ···· ${u.slice(-4)}`;
}

/** As printed on the ledger. */
export function fingerprintShort(c: string): string {
  const u = c.toUpperCase();
  return `${u.slice(0, 4)} ···· ${u.slice(-4)}`;
}

/** "g-" + 10 base32 characters of 50 bits (BigInt: JS bit operators stop at 32 bits). */
export function guardIdFromBits(bits: bigint): string {
  if (bits < 0n || bits >= 1n << 50n) throw new Error('need 50 bits');
  let id = '';
  for (let i = 0; i < 10; i++) id += BASE32[Number((bits >> BigInt(5 * (9 - i))) & 31n)];
  return 'g-' + id;
}

export function newGuardId(random: (n: number) => Uint8Array): string {
  const b = random(7);
  let bits = 0n;
  for (const x of b) bits = (bits << 8n) | BigInt(x);
  return guardIdFromBits(bits >> 6n);
}

export function isGuardId(s: string): boolean {
  return /^g-[a-z2-7]{10}$/.test(s);
}

export function randomSalt(random: (n: number) => Uint8Array): string {
  return bytesToHex(random(32));
}
