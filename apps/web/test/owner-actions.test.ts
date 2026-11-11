// The owner's freeze and close, signed in the browser: they verify for the owner key and this registry only, and a
// close names the owner's own Hyperliquid account as the one place the rest of the reserve can go.
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { base58, closeMessage, freezeMessage, nep413Hash, prepareGuard } from '@ripcord/shared';
import { describe, expect, it } from 'vitest';
import { random } from '../lib/backend';
import { REGISTRY } from '../lib/near';
import { signClose, signFreeze } from '../lib/ownerActions';

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
  it('freezes with a signature for this registry only', () => {
    expect(contents.settings.owner).toBe(`ed25519:${base58(ownerKey)}`);
    const f = signFreeze(contents, true);
    const hash = nep413Hash(freezeMessage(contents.guard_id, f.nonce, true), f.nonce, REGISTRY);
    expect(ed25519.verify(hexToBytes(f.sig), hash, ownerKey)).toBe(true);
    const elsewhere = nep413Hash(freezeMessage(contents.guard_id, f.nonce, true), f.nonce, 'another.near');
    expect(ed25519.verify(hexToBytes(f.sig), elsewhere, ownerKey)).toBe(false);
    expect(f).toMatchObject({ owner: contents.settings.owner, owner_salt: contents.owner_salt, frozen: true });
  });

  it('closes to the owner’s own Hyperliquid account and nowhere else', () => {
    const c = signClose(contents);
    const own = closeMessage(contents.guard_id, 'hypercore', contents.settings.hl_address, c.nonce);
    const other = closeMessage(contents.guard_id, 'hypercore', '0x0000000000000000000000000000000000000001', c.nonce);
    expect(ed25519.verify(hexToBytes(c.sig), nep413Hash(own, c.nonce, REGISTRY), ownerKey)).toBe(true);
    expect(ed25519.verify(hexToBytes(c.sig), nep413Hash(other, c.nonce, REGISTRY), ownerKey)).toBe(false);
    expect(c.nonce).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
