// A guard an agent sets up for its own Hyperliquid account, on the machine the agent runs on. Everything sealed is
// made here with the same shared code as the browser; only three hashes and a sealed envelope leave. The seal file,
// with the owner key that can freeze the guard, stays on this disk, locked with the operator's passphrase, which the
// model never sees. Ripcord's relay carries the sealed requests to the checker, as it does for the browser.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  createInput,
  freezeMessage,
  isSealFile,
  MIN_RESERVE_USD,
  nep413Hash,
  open,
  openSealFile,
  prepareGuard,
  writeSealFile,
  type Holding,
  type Preset,
  type SealContents,
} from '@ripcord/shared';
import { readAccount, type Sources } from './read';
import { markedPreset } from './risk';

/** A USDC reserve: 1Click's ids, as in the app's `lib/assets.ts`. */
export const USDC_NEAR = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const FUND_FROM = {
  arbitrum: {
    id: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    chain: 'Arbitrum',
    extra: 0,
    how: 'Send USDC on Arbitrum to this address.',
    note: 'Nothing on Arbitrum ties this send to the Hyperliquid account, so the reserve stays unsized.',
  },
  hyperliquid: {
    id: '1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054',
    chain: 'Hyperliquid',
    // 1Click needs $1 more on a send from Hyperliquid.
    extra: 1,
    how: "Send it from the guarded Hyperliquid account with Hyperliquid's usdSend (Portfolio → Send).",
    note: 'This send shows on Hyperliquid, so anyone can see its size. From Arbitrum the reserve stays unsized.',
  },
} as const;
export type FundFrom = keyof typeof FUND_FROM;

const GUARD_DAYS = 90;
const GUARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface OwnerDeps {
  sources: Sources;
  /** Ripcord's relay to the checker (`<app>/api/checker`); null when no app is configured. */
  relay: string | null;
  pokers: string[];
  /** Where seal files live. */
  home: string;
  /** Locks the seal files; set by the operator, never passed through the model. */
  passphrase: string | null;
  random: (n: number) => Uint8Array;
  now: () => number;
  /** Lower only in tests: the seal file's scrypt cost. */
  scryptN?: number;
}

interface Answer {
  status?: string;
  refused?: string;
  sealed?: string;
  enc_pk?: string;
  error?: string;
}

async function relay(d: OwnerDeps, input: object): Promise<Answer> {
  if (!d.relay) throw new Error("Set RIPCORD_APP_URL: a guard is reached through Ripcord's relay.");
  const res = await d.sources.fetch(d.relay, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(90_000),
  });
  const a = (await res.json()) as Answer;
  if (a.refused) throw new Error(`The guard refused: ${a.refused}.`);
  if (!res.ok) throw new Error(`The relay answered ${res.status}: ${a.error ?? 'no reason given'}.`);
  return a;
}

const opened = <T>(sealed: string, c: { receipt_secret: string; guard_id: string }): T =>
  JSON.parse(new TextDecoder().decode(open(hexToBytes(c.receipt_secret), hexToBytes(sealed), c.guard_id))) as T;

function passphraseOf(d: OwnerDeps): string {
  if (!d.passphrase || d.passphrase.length < 12)
    throw new Error(
      'Set RIPCORD_PASSPHRASE (12 characters or more) in this server’s environment: it locks the seal files, and the model never sees it.',
    );
  return d.passphrase;
}

export function sealPath(d: OwnerDeps, guardId: string): string {
  if (!GUARD_ID.test(guardId)) throw new Error('That is not a guard id.');
  return join(d.home, `${guardId}.ripcord-seal.json`);
}

async function openGuard(d: OwnerDeps, guardId: string): Promise<SealContents> {
  const pass = passphraseOf(d);
  let file: unknown;
  try {
    file = JSON.parse(await readFile(sealPath(d, guardId), 'utf8'));
  } catch {
    throw new Error(`No seal file for guard ${guardId} in ${d.home}.`);
  }
  if (!isSealFile(file)) throw new Error(`The file for guard ${guardId} is not a seal file.`);
  try {
    return (await openSealFile(file, pass)).contents;
  } catch {
    throw new Error(`The seal file for guard ${guardId} doesn't open with this server's passphrase.`);
  }
}

/** What the guard watches: the nearest cross position, or the isolated position itself. */
function watchedDistance(h: Holding, all: Holding[]): number | null {
  if (h.margin === 'isolated') return h.distance;
  const cross = all.filter((x) => x.margin === 'cross' && x.distance !== null).map((x) => x.distance as number);
  return cross.length ? Math.min(...cross) : null;
}

export interface Created {
  guardId: string;
  fingerprint: string;
  file: string;
  position: string;
  margin: 'cross' | 'isolated';
  /** An isolated guard's key to approve on Hyperliquid: it can add margin and can't withdraw. */
  approval: { agent: string; name: string } | null;
}

/** Seals a guard for one position (a cross guard covers every cross position) and keeps its seal file here. */
export async function createGuard(
  d: OwnerDeps,
  o: {
    address: string;
    coin: string;
    reserveUsd?: number | undefined;
    preset?: Preset | undefined;
    days?: number | undefined;
  },
): Promise<Created> {
  const pass = passphraseOf(d);
  const account = await readAccount(d.sources, o.address);
  const h = account.holdings.find((x) => x.coin.toUpperCase() === o.coin.toUpperCase());
  if (!h) throw new Error(`No open ${o.coin} position on this account.`);
  const distance = watchedDistance(h, account.holdings);
  if (distance === null) throw new Error('This position has no liquidation price, so there is nothing to guard.');
  const reserveUsd = o.reserveUsd ?? Math.max(MIN_RESERVE_USD, Math.ceil(h.marginUsed * 100) / 100);
  const preset = o.preset ?? markedPreset(h.coin, h.leverage, reserveUsd / h.marginUsed);
  const p = prepareGuard(
    {
      hl_address: o.address,
      preset,
      distance,
      budget_usd: reserveUsd,
      reserve_asset: USDC_NEAR,
      isolated: h.margin === 'isolated' ? h.coin : null,
      days: o.days ?? GUARD_DAYS,
    },
    d.random,
    d.now(),
  );
  const c = p.contents;
  // The seal file first: a guard is never made without the key that can freeze it.
  const file = sealPath(d, c.guard_id);
  await mkdir(d.home, { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(await writeSealFile(c, p.commitment, pass, d.random, d.scryptN)), {
    mode: 0o600,
  });
  const pk = (await relay(d, { action: 'pubkey' })).enc_pk;
  if (!pk) throw new Error("The checker didn't give its key.");
  const a = await relay(d, createInput(p, pk, d.random));
  const agent = a.sealed ? opened<{ agent: string }>(a.sealed, c).agent : null;
  const untilMs = Number(BigInt(c.settings.expires_at) / 1_000_000n);
  return {
    guardId: c.guard_id,
    fingerprint: p.fingerprint,
    file,
    position: `${h.coin} ${h.side.toLowerCase()}`,
    margin: h.margin,
    approval: agent && c.agent_name ? { agent, name: `${c.agent_name} valid_until ${untilMs}` } : null,
  };
}

export interface Funding {
  address: string;
  chain: string;
  /** Exactly what to send, in USDC. */
  amount: string;
  how: string;
  note: string;
}

/** Where to send the reserve from one source: an address only this guard's wallet receives at. */
export async function fundGuard(d: OwnerDeps, o: { guardId: string; from: FundFrom }): Promise<Funding> {
  const c = await openGuard(d, o.guardId);
  const src = FUND_FROM[o.from];
  const a = await relay(d, { action: 'fund', guard_id: c.guard_id, source_asset: src.id });
  const dep = opened<{ deposit_address: string; amount: string; decimals: number }>(a.sealed ?? '', c);
  const reserve = Number(dep.amount) / 10 ** dep.decimals;
  // From Hyperliquid, whole cents rounded up with the $1 the send carries; elsewhere the exact amount.
  const amount = src.extra
    ? (Math.ceil((reserve + src.extra) * 100 - 1e-6) / 100).toFixed(2)
    : String(Math.round(reserve * 1e6) / 1e6);
  return { address: dep.deposit_address, chain: src.chain, amount, how: src.how, note: src.note };
}

/**
 * Once the reserve lands, the checker puts the guard on NEAR as this call reads its reserve, and the pokers are
 * handed it: only the owner's side can prove which account it guards.
 */
export async function finishGuard(
  d: OwnerDeps,
  o: { guardId: string },
): Promise<{ state: 'waiting' | 'guarding'; watchers: number }> {
  const c = await openGuard(d, o.guardId);
  const a = await relay(d, { action: 'reserve', guard_id: c.guard_id });
  const { balances } = opened<{ balances: { token: string; balance: string }[] }>(a.sealed ?? '', c);
  const held = balances.find((b) => b.token === c.settings.reserve_asset)?.balance ?? '0';
  if (BigInt(held) === 0n) return { state: 'waiting', watchers: 0 };
  const answers = await Promise.allSettled(
    d.pokers.map((p) =>
      d.sources.fetch(`${p}/v1/watch/${c.guard_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hl_address: c.settings.hl_address, account_salt: c.settings.account_salt }),
        signal: AbortSignal.timeout(15_000),
      }),
    ),
  );
  return { state: 'guarding', watchers: answers.filter((r) => r.status === 'fulfilled' && r.value.ok).length };
}

/** The owner's freeze: while frozen nothing leaves the reserve, rescues included. Signed here with the seal file's key. */
export async function freezeGuard(d: OwnerDeps, o: { guardId: string; frozen: boolean }): Promise<void> {
  const c = await openGuard(d, o.guardId);
  if (!c.owner_secret) throw new Error('A NEAR wallet owns this guard: freeze it from the app’s /freeze page.');
  const nonce = bytesToHex(d.random(12));
  const sig = ed25519.sign(
    nep413Hash(freezeMessage(c.guard_id, nonce, o.frozen), nonce, d.sources.registry),
    hexToBytes(c.owner_secret),
  );
  await relay(d, {
    action: 'freeze',
    guard_id: c.guard_id,
    owner: c.settings.owner,
    owner_salt: c.owner_salt,
    sig: bytesToHex(sig),
    nonce,
    frozen: o.frozen,
  });
}
