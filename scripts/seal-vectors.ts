// Writes packages/shared/vectors/seal.json with fixed keys and nonces, so the TypeScript (@noble) and Rust
// (RustCrypto) seal implementations can be checked against each other byte for byte. Rerun after a format change:
//   corepack pnpm exec tsx scripts/seal-vectors.ts
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sealPublicKey, sealWith } from '../packages/shared/src/seal';

const bytes = (label: string, n: number) => new Uint8Array(createHash('sha512').update(label).digest()).slice(0, n);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const recipientSecret = bytes('ripcord seal vector: recipient', 32);
const cases = [
  { guard_id: 'g-vf6per4bfx', plaintext: '{"salt":"ab","settings":{"preset":"balanced"}}' },
  { guard_id: 'g-k3m7xq2tpa', plaintext: '' },
  { guard_id: 'g-h2y6wnd4re', plaintext: 'é ✓ '.repeat(40) },
].map((c, i) => {
  const eph = bytes(`ripcord seal vector: eph ${i}`, 32);
  const nonce = bytes(`ripcord seal vector: nonce ${i}`, 12);
  const pt = new TextEncoder().encode(c.plaintext);
  return {
    ...c,
    eph_secret: hex(eph),
    nonce: hex(nonce),
    envelope: hex(sealWith(eph, nonce, sealPublicKey(recipientSecret), pt, c.guard_id)),
  };
});

writeFileSync(
  new URL('../packages/shared/vectors/seal.json', import.meta.url),
  JSON.stringify(
    { recipient_secret: hex(recipientSecret), recipient_pk: hex(sealPublicKey(recipientSecret)), cases },
    null,
    1,
  ) + '\n',
);
console.log('wrote packages/shared/vectors/seal.json');
