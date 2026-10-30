// What an owner signs (docs/SPEC.md §2). The registry rebuilds the same strings on chain, so the web app, the
// MCP tool and the contract must agree byte for byte; the golden vectors keep them equal.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonical, type Json } from './canonical';

const sha256Hex = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));

export interface Proof {
  at: number;
  hl_credit_usd: number;
  hl_tx: string;
}

export const freezeMessage = (guardId: string, nonce: string, frozen = true) =>
  `ripcord:${frozen ? 'freeze' : 'unfreeze'}:${guardId}:${nonce}`;

export const policyMessage = (guardId: string, encryptedPolicy: string, nonce: string) =>
  `ripcord:policy:${guardId}:${sha256Hex(encryptedPolicy)}:${nonce}`;

export const publishMessage = (guardId: string, index: number, proof: Proof, nonce: string) =>
  `ripcord:publish:${guardId}:${index}:${sha256Hex(canonical(proof as unknown as Json))}:${nonce}`;

export const closeMessage = (guardId: string, chain: string, address: string, nonce: string) =>
  `ripcord:close:${guardId}:${chain}:${address}:${nonce}`;

/** NEP-413 tag: 2^31 + 413. */
const NEP413_TAG = 2 ** 31 + 413;

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/**
 * The 32 bytes a NEAR key signs for an owner action: sha256(borsh(tag) ‖ borsh(Payload { message,
 * nonce: sha256(nonce), recipient: the registry account, callback_url: None })).
 */
export function nep413Hash(message: string, nonce: string, recipient: string): Uint8Array {
  const m = utf8ToBytes(message);
  const r = utf8ToBytes(recipient);
  const parts = [
    u32le(NEP413_TAG),
    u32le(m.length),
    m,
    sha256(utf8ToBytes(nonce)),
    u32le(r.length),
    r,
    new Uint8Array([0]),
  ];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return sha256(all);
}
