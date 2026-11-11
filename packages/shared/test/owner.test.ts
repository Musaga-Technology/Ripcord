// The strings an owner signs and the NEP-413 hash, against the reference vectors (the contract checks the same).
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import v from '../vectors/commitment.json' with { type: 'json' };
import {
  closeMessage,
  freezeMessage,
  nep413Hash,
  policyMessage,
  publishMessage,
  resealMessage,
  topupDigest,
  topupMessage,
  type Proof,
} from '../src/index';

describe('owner messages', () => {
  it.each(v.messages)('$kind', (m) => {
    const built = {
      freeze: () => freezeMessage(m.guard_id, m.nonce),
      unfreeze: () => freezeMessage(m.guard_id, m.nonce, false),
      policy: () => policyMessage(m.guard_id, m.encrypted_policy!, m.nonce),
      publish: () => publishMessage(m.guard_id, m.index!, m.proof as Proof, m.nonce),
      close: () => closeMessage(m.guard_id, m.chain!, m.address!, m.nonce),
      topup: () => topupMessage(m.guard_id, topupDigest(m.guard_id, m.cents!, m.salt!), m.nonce),
      reseal: () => resealMessage(m.guard_id, m.commitment!, m.nonce),
    }[m.kind as 'freeze']();
    expect(built).toBe(m.message);
  });
  it.each(v.nep413)('NEP-413 hash for $recipient', (n) =>
    expect(bytesToHex(nep413Hash(n.message, n.nonce, n.recipient))).toBe(n.hash),
  );
});
