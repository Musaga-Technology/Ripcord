// Base58 (Bitcoin's alphabet), for `ed25519:<base58>` owner keys. Mirrors bs58_encode in checker/src/near_tx.rs.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

/** The bytes of a base58 string; throws on a character outside the alphabet. */
export function fromBase58(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('not base58');
    n = n * 58n + BigInt(v);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    out.unshift(0);
  }
  return new Uint8Array(out);
}
