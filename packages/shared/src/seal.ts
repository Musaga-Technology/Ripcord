// Sealing guard settings to the checker's enclave key (docs/SPEC.md §1, §3): X25519 key agreement, HKDF-SHA256,
// ChaCha20-Poly1305. The guard id is bound as associated data, so an envelope can't be moved to another guard.
// Mirrored in crates/rules/src/seal.rs; vectors/seal.json keeps the two byte-for-byte equal.
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export const SEAL_INFO = 'ripcord:seal:v1';
const VERSION = 1;

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function key(shared: Uint8Array, eph: Uint8Array, recipient: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, concat(eph, recipient), utf8ToBytes(SEAL_INFO), 32);
}

const aad = (guardId: string) => utf8ToBytes(`${SEAL_INFO}:${guardId}`);

/** Envelope: version (1 byte) ‖ ephemeral public key (32) ‖ nonce (12) ‖ ciphertext with tag. Deterministic given its inputs. */
export function sealWith(
  ephSecret: Uint8Array,
  nonce: Uint8Array,
  recipientPk: Uint8Array,
  plaintext: Uint8Array,
  guardId: string,
): Uint8Array {
  const eph = x25519.getPublicKey(ephSecret);
  const k = key(x25519.getSharedSecret(ephSecret, recipientPk), eph, recipientPk);
  const ct = chacha20poly1305(k, nonce, aad(guardId)).encrypt(plaintext);
  return concat(new Uint8Array([VERSION]), eph, nonce, ct);
}

/** Seal with fresh randomness: what the browser does with the settings before they leave the device. */
export function seal(
  recipientPk: Uint8Array,
  plaintext: Uint8Array,
  guardId: string,
  random: (n: number) => Uint8Array,
): Uint8Array {
  return sealWith(random(32), random(12), recipientPk, plaintext, guardId);
}

/** Opens an envelope with the recipient's secret; throws if it was altered, or sealed for another key or guard. */
export function open(recipientSecret: Uint8Array, envelope: Uint8Array, guardId: string): Uint8Array {
  if (envelope.length < 1 + 32 + 12 + 16 || envelope[0] !== VERSION) throw new Error('not a sealed envelope');
  const eph = envelope.slice(1, 33);
  const nonce = envelope.slice(33, 45);
  const recipient = x25519.getPublicKey(recipientSecret);
  const k = key(x25519.getSharedSecret(recipientSecret, eph), eph, recipient);
  return chacha20poly1305(k, nonce, aad(guardId)).decrypt(envelope.slice(45));
}

export const sealPublicKey = (secret: Uint8Array) => x25519.getPublicKey(secret);
