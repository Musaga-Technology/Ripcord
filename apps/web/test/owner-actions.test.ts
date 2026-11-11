// The owner's freeze and close, signed in the browser: they verify for the owner key and this registry only, and a
// close names the owner's own Hyperliquid account as the one place the rest of the reserve can go.
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  base58,
  closeMessage,
  commitment,
  freezeMessage,
  nep413Hash,
  open,
  prepareGuard,
  resealMessage,
  topupDigest,
  topupMessage,
} from '@ripcord/shared';
import { describe, expect, it } from 'vitest';
import { demo, random } from '../lib/backend';
import { REGISTRY } from '../lib/near';
import { resealed, signClose, signFreeze, signReseal, signTopup, withRange } from '../lib/ownerActions';

const contents = prepareGuard(
  {
    hl_address: '0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3',
    preset: 'balanced',
    distance: 17.3,
    budget_usd: 2.7,
    reserve_asset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    isolated: null,
    days: 30,
  },
  random,
  Date.now(),
).contents;
const ownerKey = ed25519.getPublicKey(hexToBytes(contents.owner_secret));

describe("the owner's own actions", () => {
  it('freezes with a signature for this registry only', async () => {
    expect(contents.settings.owner).toBe(`ed25519:${base58(ownerKey)}`);
    const f = await signFreeze(contents, true);
    const hash = nep413Hash(freezeMessage(contents.guard_id, f.nonce, true), f.nonce, REGISTRY);
    expect(ed25519.verify(hexToBytes(f.sig), hash, ownerKey)).toBe(true);
    const elsewhere = nep413Hash(freezeMessage(contents.guard_id, f.nonce, true), f.nonce, 'another.near');
    expect(ed25519.verify(hexToBytes(f.sig), elsewhere, ownerKey)).toBe(false);
    expect(f).toMatchObject({ owner: contents.settings.owner, owner_salt: contents.owner_salt, frozen: true });
  });

  it('closes to the owner’s own Hyperliquid account and nowhere else', async () => {
    const c = await signClose(contents);
    const own = closeMessage(contents.guard_id, 'hypercore', contents.settings.hl_address, c.nonce);
    const other = closeMessage(contents.guard_id, 'hypercore', '0x0000000000000000000000000000000000000001', c.nonce);
    expect(ed25519.verify(hexToBytes(c.sig), nep413Hash(own, c.nonce, REGISTRY), ownerKey)).toBe(true);
    expect(ed25519.verify(hexToBytes(c.sig), nep413Hash(other, c.nonce, REGISTRY), ownerKey)).toBe(false);
    expect(c.nonce).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  const enclave = random(32);
  const enclavePk = bytesToHex(x25519.getPublicKey(enclave));
  const opens = (hex: string) =>
    JSON.parse(new TextDecoder().decode(open(enclave, hexToBytes(hex), contents.guard_id))) as Record<string, unknown>;

  it('tops up with an amount only the enclave reads, and a signature over its hidden digest', async () => {
    const t = await signTopup(contents, 12.5, enclavePk);
    const { cents, salt } = opens(t.enc_amount) as { cents: number; salt: string };
    expect(cents).toBe(1250);
    expect(JSON.stringify(t)).not.toContain('1250');
    const message = topupMessage(contents.guard_id, topupDigest(contents.guard_id, cents, salt), t.nonce);
    expect(ed25519.verify(hexToBytes(t.sig), nep413Hash(message, t.nonce, REGISTRY), ownerKey)).toBe(true);
    const more = topupMessage(contents.guard_id, topupDigest(contents.guard_id, 99_999, salt), t.nonce);
    expect(ed25519.verify(hexToBytes(t.sig), nep413Hash(more, t.nonce, REGISTRY), ownerKey)).toBe(false);
  });

  it('signs a new range as the fingerprint of the new settings, and seals the range to the enclave', async () => {
    const next = withRange(contents.settings, 'safer', 17.3)!;
    expect(next.preset).toBe('safer');
    expect(next.line_range_pct).not.toEqual(contents.settings.line_range_pct);
    expect(withRange(contents.settings, 'lean', 0.6)).toBeNull();
    const r = await signReseal(contents, next, enclavePk);
    expect(r.commitment).toBe(commitment(next, contents.salt));
    expect(opens(r.enc_range)).toEqual({
      preset: 'safer',
      line_range_pct: next.line_range_pct,
      target_range_pct: next.target_range_pct,
    });
    const message = resealMessage(contents.guard_id, r.commitment, r.nonce);
    expect(ed25519.verify(hexToBytes(r.sig), nep413Hash(message, r.nonce, REGISTRY), ownerKey)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(String(next.line_range_pct[0]));

    const after = resealed(contents, next, 4);
    expect(after.settings).toEqual(next);
    expect(after.earlier).toEqual([
      {
        until_epoch: 4,
        line_range_pct: contents.settings.line_range_pct,
        target_range_pct: contents.settings.target_range_pct,
      },
    ]);
  });

  it('runs the same in the simulation, which refuses a range that differs from the one signed', async () => {
    const b = demo();
    const pk = await b.pubkey();
    const next = withRange(contents.settings, 'safer', 17.3)!;
    expect(await b.reseal(contents, await signReseal(contents, next, pk))).toBe(1);
    const other = withRange(contents.settings, 'lean', 17.3)!;
    const forged = {
      ...(await signReseal(contents, next, pk)),
      enc_range: (await signReseal(contents, other, pk)).enc_range,
    };
    await expect(b.reseal(contents, forged)).rejects.toThrow('does not match the signed fingerprint');
    await expect(b.topup(contents, await signTopup(contents, 1.5, pk), 'x')).rejects.toThrow('$2 or more');
  });
});
