// Setting a guard up: only hashes and a sealed envelope leave the device, and the seal file opens only with its
// passphrase.
import { x25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  accountCommitment,
  base58,
  commitment,
  fromBase58,
  createInput,
  isGuardId,
  isSealFile,
  open,
  ownerCommitment,
  openSealFile,
  prepareGuard,
  readSealFile,
  rewriteSealFile,
  writeSealFile,
  type GuardDraft,
} from '../src/index';

const random = (n: number) => new Uint8Array(randomBytes(n));
const HL = '0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3';
const draft: GuardDraft = {
  hl_address: HL,
  preset: 'balanced',
  distance: 17.3,
  budget_usd: 4200.5,
  reserve_asset: 'nep141:btc.omft.near',
  isolated: null,
  days: 90,
};
const NOW = 1_793_000_000_000;

describe('prepareGuard', () => {
  it('makes settings the checker accepts and hashes that match them', () => {
    const p = prepareGuard(draft, random, NOW);
    const { settings: s, salt, owner_salt, guard_id } = p.contents;
    expect(isGuardId(guard_id)).toBe(true);
    expect(s.hl_address).toBe(HL.toLowerCase());
    expect(s.owner).toMatch(/^ed25519:/);
    expect(s.line_range_pct).toEqual([8.82, 11.94]);
    expect(s.target_range_pct).toEqual([14.71, 19.9]);
    expect(s.speed_aware).toBe(true);
    expect(s.max_rescue_usd).toBe(4200.5);
    expect(s.expires_at).toBe('1800776000000000000');
    expect(p.commitment).toBe(commitment(s, salt));
    expect(p.owner_commitment).toBe(ownerCommitment(s.owner, owner_salt));
    expect(p.account_commitment).toBe(accountCommitment(HL, s.account_salt));
  });

  it('refuses what the checker would refuse', () => {
    expect(() => prepareGuard({ ...draft, distance: 0.5 }, random, NOW)).toThrow(/too close/);
    expect(() => prepareGuard({ ...draft, budget_usd: 1.5 }, random, NOW)).toThrow(/at least \$2/);
    expect(prepareGuard({ ...draft, budget_usd: 2.7 }, random, NOW).contents.settings.max_rescue_usd).toBe(2.7);
  });

  it('gives an isolated guard a random agent name, never one that announces it', () => {
    const a = prepareGuard({ ...draft, isolated: 'HYPE' }, random, NOW).contents;
    const b = prepareGuard({ ...draft, isolated: 'HYPE' }, random, NOW).contents;
    expect(a.settings.isolated).toEqual({ coin: 'HYPE' });
    expect(a.agent_name).toMatch(/^[0-9a-f]{8}$/);
    expect(a.agent_name).not.toBe(b.agent_name);
    expect(prepareGuard(draft, random, NOW).contents.agent_name).toBeNull();
  });
});

describe('what leaves the device', () => {
  const enclaveSecret = random(32);
  const enclavePk = Buffer.from(x25519.getPublicKey(enclaveSecret)).toString('hex');
  const p = prepareGuard(draft, random, NOW);
  const input = createInput(p, enclavePk, random);
  const sent = JSON.stringify(input);

  it('carries no setting, address, salt or secret in the clear', () => {
    const { settings: s, salt, owner_salt, owner_secret, receipt_secret } = p.contents;
    for (const secret of [
      HL.toLowerCase(),
      HL,
      s.owner,
      s.account_salt,
      salt,
      owner_salt,
      owner_secret,
      receipt_secret,
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(sent).not.toContain('8.82');
    expect(sent).not.toContain('4200.5');
    expect(sent).not.toContain('btc.omft');
  });

  it('opens only in the enclave, only for this guard', () => {
    const plain = open(enclaveSecret, hexToBytes(input.enc_settings), input.guard_id);
    const got = JSON.parse(new TextDecoder().decode(plain));
    expect(got.settings).toEqual(p.contents.settings);
    expect(got.salt).toBe(p.contents.salt);
    expect(() => open(enclaveSecret, hexToBytes(input.enc_settings), 'g-aaaaaaaaaa')).toThrow();
    expect(() => open(random(32), hexToBytes(input.enc_settings), input.guard_id)).toThrow();
  });
});

describe('seal file', () => {
  const p = prepareGuard(draft, random, NOW);
  const LOW_N = 2 ** 10; // the real N takes seconds; the format is the same

  it('opens with its passphrase and shows nothing without it', async () => {
    const file = await writeSealFile(p.contents, p.commitment, 'correct horse', random, LOW_N);
    expect(isSealFile(file)).toBe(true);
    const text = JSON.stringify(file);
    expect(text).not.toContain(p.contents.owner_secret);
    expect(text).not.toContain(HL.toLowerCase());
    expect(await readSealFile(file, 'correct horse')).toEqual(p.contents);
    await expect(readSealFile(file, 'wrong horse')).rejects.toThrow();
  });

  it('is rewritten after a change under the same passphrase, without asking for it again', async () => {
    const file = await writeSealFile(p.contents, p.commitment, 'correct horse', random, LOW_N);
    const { contents, key } = await openSealFile(file, 'correct horse');
    const changed = {
      ...contents,
      earlier: [
        { until_epoch: 3, line_range_pct: [1, 2] as [number, number], target_range_pct: [3, 4] as [number, number] },
      ],
    };
    const again = rewriteSealFile(changed, 'f'.repeat(64), key, file.kdf, random);
    expect(again.nonce).not.toBe(file.nonce);
    expect(again.commitment).toBe('f'.repeat(64));
    expect(await readSealFile(again, 'correct horse')).toEqual(changed);
    await expect(readSealFile(again, 'wrong horse')).rejects.toThrow();
  });

  it('refuses an altered file, and one moved to another guard', async () => {
    const file = await writeSealFile(p.contents, p.commitment, 'pw', random, LOW_N);
    const flipped = (file.ciphertext[0] === '0' ? '1' : '0') + file.ciphertext.slice(1);
    await expect(readSealFile({ ...file, ciphertext: flipped }, 'pw')).rejects.toThrow();
    await expect(readSealFile({ ...file, guard_id: 'g-aaaaaaaaaa' }, 'pw')).rejects.toThrow();
  });
});

describe('base58', () => {
  it('encodes as NEAR expects, keeping leading zeros', () => {
    expect(base58(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(base58(hexToBytes('61'))).toBe('2g');
  });

  it('decodes what it encodes, leading zeros included, and refuses other characters', () => {
    for (const b of [new Uint8Array([0, 0, 1]), hexToBytes('61'), random(32)]) expect(fromBase58(base58(b))).toEqual(b);
    expect(() => fromBase58('0OIl')).toThrow('not base58');
  });
});
