// The seal file (docs/SPEC.md §1): the owner's copy of a guard, encrypted with a passphrase they choose
// (scrypt → ChaCha20-Poly1305). It holds the owner key, so it is the key to the reserve; the guard id and commitment
// outside the encryption are already public on the registry, and let the app name a file without opening it.
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { GuardSettings } from './types';

export interface SealContents {
  guard_id: string;
  settings: GuardSettings;
  salt: string;
  owner_salt: string;
  /** 32 bytes of hex: the ed25519 owner key and the X25519 receipt key. */
  owner_secret: string;
  receipt_secret: string;
  /** An isolated guard's agent name on Hyperliquid; random, so it can't announce the guard. */
  agent_name: string | null;
}

export interface SealFile {
  ripcord_seal: 1;
  guard_id: string;
  commitment: string;
  /** scrypt parameters and salt, then the nonce and ciphertext, in hex. */
  kdf: { n: number; r: number; p: number; salt: string };
  nonce: string;
  ciphertext: string;
}

/** 64 MB and about a second on a phone. */
export const SCRYPT_N = 2 ** 16;

async function fileKey(passphrase: string, kdf: SealFile['kdf']): Promise<Uint8Array> {
  return scryptAsync(utf8ToBytes(passphrase.normalize('NFKC')), hexToBytes(kdf.salt), {
    N: kdf.n,
    r: kdf.r,
    p: kdf.p,
    dkLen: 32,
  });
}

const aad = (guardId: string) => utf8ToBytes(`ripcord:seal-file:v1:${guardId}`);

export async function writeSealFile(
  contents: SealContents,
  commitment: string,
  passphrase: string,
  random: (n: number) => Uint8Array,
  n = SCRYPT_N,
): Promise<SealFile> {
  const kdf = { n, r: 8, p: 1, salt: bytesToHex(random(16)) };
  const nonce = random(12);
  const key = await fileKey(passphrase, kdf);
  const ciphertext = chacha20poly1305(key, nonce, aad(contents.guard_id)).encrypt(
    utf8ToBytes(JSON.stringify(contents)),
  );
  return {
    ripcord_seal: 1,
    guard_id: contents.guard_id,
    commitment,
    kdf,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
}

/** Opens a seal file; throws on a wrong passphrase or an altered file, which look the same on purpose. */
export async function readSealFile(file: SealFile, passphrase: string): Promise<SealContents> {
  const key = await fileKey(passphrase, file.kdf);
  const plain = chacha20poly1305(key, hexToBytes(file.nonce), aad(file.guard_id)).decrypt(hexToBytes(file.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain)) as SealContents;
}

export function isSealFile(v: unknown): v is SealFile {
  const f = v as Partial<SealFile> | null;
  return !!f && f.ripcord_seal === 1 && typeof f.guard_id === 'string' && typeof f.ciphertext === 'string' && !!f.kdf;
}
