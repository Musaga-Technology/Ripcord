// A stand-in for the checker behind Ripcord's relay, built from the same shared functions the enclave mirrors: it
// opens sealed settings with its own key, refuses any that don't match all three public hashes, seals its answers to
// the owner, and checks an owner's freeze signature the way the registry does.
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  accountCommitment,
  commitment,
  freezeMessage,
  fromBase58,
  nep413Hash,
  open,
  ownerCommitment,
  seal,
  type GuardSettings,
} from '@ripcord/shared';

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const RELAY = 'https://app.test/api/checker';
export const POKER = 'https://poker.test';
export const AGENT = `0x${'ab'.repeat(20)}`;

interface Stored {
  settings: GuardSettings;
  salt: string;
  owner_salt: string;
  owner_commitment: string;
}

export function fakeChecker(registry = 'ripcord-registry.near') {
  const secret = random(32);
  const guards = new Map<string, Stored>();
  const funded = new Set<string>();
  const frozen = new Map<string, boolean>();
  /** Every request body the relay carried, as sent. */
  const bodies: string[] = [];
  const watches: { guardId: string; body: Record<string, string> }[] = [];

  const sealFor = (s: GuardSettings, id: string, v: unknown) =>
    bytesToHex(seal(hexToBytes(s.receipt_pk.slice('x25519:'.length)), utf8ToBytes(JSON.stringify(v)), id, random));

  function handle(i: Record<string, unknown>): Record<string, unknown> {
    const id = String(i.guard_id ?? '');
    const g = guards.get(id);
    switch (i.action) {
      case 'pubkey':
        return { enc_pk: bytesToHex(x25519.getPublicKey(secret)) };
      case 'create': {
        const p = JSON.parse(new TextDecoder().decode(open(secret, hexToBytes(String(i.enc_settings)), id))) as Omit<
          Stored,
          'owner_commitment'
        >;
        const ok =
          commitment(p.settings, p.salt) === i.commitment &&
          ownerCommitment(p.settings.owner, p.owner_salt) === i.owner_commitment &&
          accountCommitment(p.settings.hl_address, p.settings.account_salt) === i.account_commitment;
        if (!ok) return { refused: 'settings do not match the public commitments' };
        guards.set(id, { ...p, owner_commitment: String(i.owner_commitment) });
        return p.settings.isolated
          ? { status: 'pending', sealed: sealFor(p.settings, id, { agent: AGENT }) }
          : { status: 'pending' };
      }
      case 'fund':
        if (!g) return { refused: 'no such guard' };
        return {
          status: 'pending',
          sealed: sealFor(g.settings, id, {
            deposit_address: `deposit-${String(i.source_asset).slice(0, 10)}`,
            amount: String(Math.round(g.settings.budget_usd * 1e6)),
            decimals: 6,
          }),
        };
      case 'reserve': {
        if (!g) return { refused: 'no such guard' };
        const balance = funded.has(id) ? String(Math.round(g.settings.budget_usd * 1e6)) : '0';
        return { sealed: sealFor(g.settings, id, { balances: [{ token: g.settings.reserve_asset, balance }] }) };
      }
      case 'freeze': {
        if (!g) return { refused: 'no such guard' };
        const owner = String(i.owner);
        const signed =
          owner.startsWith('ed25519:') &&
          ed25519.verify(
            hexToBytes(String(i.sig)),
            nep413Hash(freezeMessage(id, String(i.nonce), Boolean(i.frozen)), String(i.nonce), registry),
            fromBase58(owner.slice('ed25519:'.length)),
          ) &&
          ownerCommitment(owner, String(i.owner_salt)) === g.owner_commitment;
        if (!signed) return { refused: 'not signed by the owner' };
        frozen.set(id, Boolean(i.frozen));
        return { status: 'frozen' };
      }
      default:
        return { error: 'not allowed' };
    }
  }

  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === RELAY) {
      bodies.push(String(init?.body));
      const a = handle(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(a, { status: a.refused ? 400 : a.error ? 403 : 200 });
    }
    if (u.startsWith(`${POKER}/v1/watch/`)) {
      watches.push({ guardId: u.split('/').pop()!, body: JSON.parse(String(init?.body)) as Record<string, string> });
      return Response.json({ ok: true });
    }
    return null;
  }) as (url: string | URL | Request, init?: RequestInit) => Promise<Response | null>;

  return { guards, funded, frozen, bodies, watches, fetchFn };
}
