// Setting a guard up on the owner's device (docs/ARCHITECTURE.md §4.1): everything that gets sealed is made here, and
// only the three hashes and a sealed envelope leave. The owner defaults to a key the app generates, separate from
// the trading address, so an owner-signed action reveals nothing about which account is guarded (docs/SPEC.md §1).
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base58 } from './base58';
import {
  accountCommitment,
  commitment,
  fingerprint,
  newGuardId,
  ownerCommitment,
  ownerSalt,
  randomSalt,
} from './commitment';
import { MIN_RESCUE_USD, presetRanges } from './guard';
import type { SealContents } from './sealfile';
import { seal } from './seal';
import type { GuardSettings, Preset } from './types';

const DAY_MS = 86_400_000;

export interface GuardDraft {
  hl_address: string;
  preset: Preset;
  /** The position's distance from liquidation now, %. */
  distance: number;
  budget_usd: number;
  reserve_asset: string;
  /** The coin, for an isolated position. */
  isolated: string | null;
  days: number;
}

export interface PreparedGuard {
  contents: SealContents;
  commitment: string;
  owner_commitment: string;
  account_commitment: string;
  fingerprint: string;
}

/** A reserve must hold at least one rescue: the route's minimum (the checker refuses a smaller cap). */
export const MIN_RESERVE_USD = MIN_RESCUE_USD;

export function prepareGuard(d: GuardDraft, random: (n: number) => Uint8Array, nowMs: number): PreparedGuard {
  const ranges = presetRanges(d.preset, d.distance);
  if (!ranges) throw new Error('this position is too close to liquidation for this preset');
  if (d.budget_usd < MIN_RESERVE_USD) throw new Error(`the reserve must be at least $${MIN_RESERVE_USD}`);
  const ownerSecret = random(32);
  const receiptSecret = random(32);
  const owner = `ed25519:${base58(ed25519.getPublicKey(ownerSecret))}`;
  const budget = Math.floor(d.budget_usd * 100) / 100;
  const settings: GuardSettings = {
    owner,
    hl_address: d.hl_address.toLowerCase(),
    account_salt: randomSalt(random),
    preset: d.preset,
    ...ranges,
    speed_aware: true,
    // One rescue may take the whole reserve, as in the replays; the wallet's policy enforces this cap.
    max_rescue_usd: budget,
    budget_usd: budget,
    reserve_asset: d.reserve_asset,
    cooldown_s: 60,
    isolated: d.isolated ? { coin: d.isolated } : null,
    close_hint: null,
    receipt_pk: `x25519:${bytesToHex(x25519.getPublicKey(receiptSecret))}`,
    expires_at: (BigInt(nowMs + d.days * DAY_MS) * 1_000_000n).toString(),
  };
  const salt = randomSalt(random);
  const owner_salt = ownerSalt(bytesToHex(ed25519.sign(utf8ToBytes('ripcord:owner-salt:v1'), ownerSecret)));
  const c = commitment(settings, salt);
  return {
    contents: {
      guard_id: newGuardId(random),
      settings,
      salt,
      owner_salt,
      owner_secret: bytesToHex(ownerSecret),
      receipt_secret: bytesToHex(receiptSecret),
      agent_name: d.isolated ? bytesToHex(random(4)) : null,
    },
    commitment: c,
    owner_commitment: ownerCommitment(owner, owner_salt),
    account_commitment: accountCommitment(settings.hl_address, settings.account_salt),
    fingerprint: fingerprint(c),
  };
}

export interface CreateInput {
  action: 'create';
  guard_id: string;
  commitment: string;
  owner_commitment: string;
  account_commitment: string;
  expires_at: string;
  enc_settings: string;
}

/** What leaves the device: three hashes, the expiry, and the settings sealed to the enclave. */
export function createInput(p: PreparedGuard, enclavePk: string, random: (n: number) => Uint8Array): CreateInput {
  const { settings, salt, owner_salt, guard_id } = p.contents;
  const payload = utf8ToBytes(JSON.stringify({ settings, salt, owner_salt }));
  return {
    action: 'create',
    guard_id,
    commitment: p.commitment,
    owner_commitment: p.owner_commitment,
    account_commitment: p.account_commitment,
    expires_at: settings.expires_at,
    enc_settings: bytesToHex(seal(hexToBytes(enclavePk), payload, guard_id, random)),
  };
}
