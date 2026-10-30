// The sealing scheme against its vectors (the Rust side checks the same file), and its refusals.
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import v from '../vectors/seal.json' with { type: 'json' };
import { open, sealPublicKey, sealWith } from '../src/index';

const secret = hexToBytes(v.recipient_secret);
const text = new TextDecoder();

describe('sealing settings to the enclave', () => {
  it('derives the published key', () => expect(bytesToHex(sealPublicKey(secret))).toBe(v.recipient_pk));
  it.each(v.cases)('seals and opens for $guard_id', (c) => {
    const pt = new TextEncoder().encode(c.plaintext);
    const env = sealWith(hexToBytes(c.eph_secret), hexToBytes(c.nonce), hexToBytes(v.recipient_pk), pt, c.guard_id);
    expect(bytesToHex(env)).toBe(c.envelope);
    expect(text.decode(open(secret, env, c.guard_id))).toBe(c.plaintext);
  });
  it('refuses an envelope moved to another guard', () =>
    expect(() => open(secret, hexToBytes(v.cases[0]!.envelope), 'g-aaaaaaaaaa')).toThrow());
  it('refuses a tampered envelope', () => {
    const env = hexToBytes(v.cases[0]!.envelope);
    env[env.length - 1]! ^= 1;
    expect(() => open(secret, env, v.cases[0]!.guard_id)).toThrow();
  });
  it('refuses the wrong key', () =>
    expect(() => open(new Uint8Array(32).fill(7), hexToBytes(v.cases[0]!.envelope), v.cases[0]!.guard_id)).toThrow());
});
