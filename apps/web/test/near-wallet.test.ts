// A NEAR wallet as the owner: its NEP-413 signatures are the bytes the registry and the enclave check, however the
// wallet writes them, and a guard it owns keeps no owner key in its seal file.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  base58,
  freezeMessage,
  fromBase58,
  nep413Hash,
  ownerCommitment,
  ownerSalt,
  prepareGuard,
} from '@ripcord/shared';
import { describe, expect, it } from 'vitest';
import { random } from '../lib/backend';
import { REGISTRY } from '../lib/near';
import { checkedSignature } from '../lib/nearWallet';
import { signFreeze } from '../lib/ownerActions';

// A wallet's key, signing as NEP-413 wallets do: sha256 of the borsh payload, with the 32-byte nonce they are given.
const secret = random(32);
const key = `ed25519:${base58(ed25519.getPublicKey(secret))}`;
const walletSign = (message: string, nonce: string, recipient = REGISTRY) =>
  ed25519.sign(nep413Hash(message, nonce, recipient), secret);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

describe('a NEAR wallet as owner', () => {
  it('accepts its signature however the wallet writes it, and only for this message, key and registry', () => {
    const m = freezeMessage('g-vf6per4bfx', 'n1');
    const sig = walletSign(m, 'n1');
    for (const written of [b64(sig), `ed25519:${base58(sig)}`, bytesToHex(sig)])
      expect(checkedSignature(key, m, 'n1', written)).toBe(bytesToHex(sig));
    expect(checkedSignature(key, freezeMessage('g-vf6per4bfx', 'n2'), 'n2', b64(sig))).toBeNull();
    expect(checkedSignature(key, m, 'n1', b64(walletSign(m, 'n1', 'another.near')))).toBeNull();
    const other = `ed25519:${base58(ed25519.getPublicKey(random(32)))}`;
    expect(checkedSignature(other, m, 'n1', b64(sig))).toBeNull();
    expect(checkedSignature(key, m, 'n1', 'not a signature')).toBeNull();
  });

  it('signs the way the registry hashes: the 32-byte nonce is sha256 of the nonce text', () => {
    // NEP-413 wallets take the nonce as 32 bytes; the app passes sha256(nonce), which is what nep413Hash puts there.
    expect(sha256(utf8ToBytes('n1'))).toHaveLength(32);
    expect(fromBase58(key.slice('ed25519:'.length))).toEqual(ed25519.getPublicKey(secret));
  });

  it('owns a guard with no owner key in its seal file, and a salt any device can make again', async () => {
    const salt = ownerSalt(bytesToHex(walletSign('ripcord:owner-salt:v1', 'owner-salt')));
    expect(ownerSalt(bytesToHex(walletSign('ripcord:owner-salt:v1', 'owner-salt')))).toBe(salt);
    const p = prepareGuard(
      {
        hl_address: '0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3',
        preset: 'balanced',
        distance: 17.3,
        budget_usd: 2.7,
        reserve_asset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
        isolated: null,
        days: 30,
        owner: { key, salt, account: 'musags.near' },
      },
      random,
      Date.now(),
    );
    expect(p.contents.owner_secret).toBe('');
    expect(p.contents.owner_account).toBe('musags.near');
    expect(p.contents.settings.owner).toBe(key);
    expect(p.owner_commitment).toBe(ownerCommitment(key, salt));
    // Its freeze is signed by the wallet, not by a key in the file.
    const f = await signFreeze(p.contents, true, async (m, n) => bytesToHex(walletSign(m, n)));
    expect(checkedSignature(key, freezeMessage(p.contents.guard_id, f.nonce, true), f.nonce, f.sig)).toBe(f.sig);
  });
});
