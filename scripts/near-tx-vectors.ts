// Writes packages/shared/vectors/near-tx.json: function-call transactions encoded and signed by near-api-js, so the
// checker's own borsh encoder (checker/src/near_tx.rs) can be checked against the reference library byte for byte.
//   corepack pnpm exec tsx scripts/near-tx-vectors.ts
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { actions, createTransaction, encodeTransaction, KeyPair, type KeyPairString } from 'near-api-js';
import { SignedTransaction, Signature } from 'near-api-js';

const seedBytes = (label: string) => new Uint8Array(createHash('sha256').update(label).digest());
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bs58 = (b: Uint8Array) => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + (hex(b) || '0'));
  let s = '';
  while (n > 0n) {
    s = A[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b)
    if (x === 0) s = '1' + s;
    else break;
  return s;
};

// An ed25519 key from a fixed 32-byte seed: near-api-js takes "ed25519:<base58 of seed ‖ public key>".
const seed = seedBytes('ripcord near-tx vector: checker key');
const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
const spki = createPublicKey(createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })).export({
  format: 'der',
  type: 'spki',
});
const pub = new Uint8Array(spki.subarray(spki.length - 32));
const kp = KeyPair.fromString(`ed25519:${bs58(new Uint8Array([...seed, ...pub]))}` as KeyPairString);
const signer = hex(pub);

const cases = [
  {
    receiver_id: 'ripcord-registry-db06d339.testnet',
    nonce: '187654321000001',
    block_hash: hex(seedBytes('block 1')),
    method: 'set_status',
    args: { guard_id: 'g-vf6per4bfx', status: 'Guarding' },
    gas: '30000000000000',
    deposit: '0',
  },
  {
    receiver_id: 'registry.ripcord.near',
    nonce: '1',
    block_hash: hex(seedBytes('block 2')),
    method: 'register_guard',
    args: { guard_id: 'g-k3m7xq2tpa', commitment: 'ab'.repeat(32), expires_at: '1795046400000000000' },
    gas: '200000000000000',
    deposit: '30000000000000000000000',
  },
].map((c) => {
  const tx = createTransaction(
    signer,
    kp.getPublicKey(),
    c.receiver_id,
    BigInt(c.nonce),
    [actions.functionCall(c.method, c.args, BigInt(c.gas), BigInt(c.deposit))],
    Buffer.from(c.block_hash, 'hex'),
  );
  const encoded = encodeTransaction(tx);
  const hash = createHash('sha256').update(encoded).digest();
  const sig = kp.sign(hash);
  const signed = new SignedTransaction({
    transaction: tx,
    signature: new Signature({ keyType: tx.publicKey.keyType, data: sig.signature }),
  });
  return {
    ...c,
    args_json: JSON.stringify(c.args),
    encoded: hex(encoded),
    hash: hex(hash),
    signed: hex(signed.encode()),
  };
});

writeFileSync(
  new URL('../packages/shared/vectors/near-tx.json', import.meta.url),
  JSON.stringify({ signer_id: signer, public_key: hex(pub), secret_seed: hex(seed), cases }, null, 1) + '\n',
);
console.log('wrote packages/shared/vectors/near-tx.json');
