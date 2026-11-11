// The guard's enclave, as this browser reaches it. Live: Ripcord's server carries sealed requests to the checker on
// OutLayer (app/api/checker). Demo: a stand-in in this tab that does what the checker does with the same shared
// functions (opens the envelope, checks all three hashes, seals its answers to the owner), so the flow is the real one
// with no account, funds or network. What each returns is sealed to the owner either way.
import { x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  accountCommitment,
  commitment,
  open,
  ownerCommitment,
  seal,
  type CreateInput,
  type SealContents,
} from '@ripcord/shared';
import { CHECKER_PROJECT, NEAR_RPC, OUTLAYER, REGISTRY } from './near';
import type { Stats } from './ledger';
import type { CloseInput, FreezeInput, ResealInput, TopupInput } from './ownerActions';
import type { OnChainArm, OnChainGuard } from './verify';

export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export class Refused extends Error {}

export interface Deposit {
  address: string;
  /** Smallest units, and the decimals to read them with. */
  amount: string;
  decimals: number;
}

export interface Backend {
  pubkey(): Promise<string>;
  /** Registers the guard. An isolated guard's answer names the agent its owner approves. */
  create(input: CreateInput, receiptSecret: string): Promise<{ agent: string | null }>;
  fund(c: SealContents, source: string): Promise<Deposit>;
  /** The reserve's balances by token. */
  reserve(c: SealContents): Promise<Record<string, string>>;
  /** The owner's signed freeze or unfreeze, submitted for the registry to check. */
  freeze(input: FreezeInput): Promise<void>;
  /** One step of the owner's signed close: `closed` once the rest of the reserve is on its way and it's off chain. */
  close(input: CloseInput): Promise<'pending' | 'closed'>;
  /** The owner's signed top-up, from one source: the budget rises once, and each source gets its own address. */
  topup(c: SealContents, input: TopupInput, source: string): Promise<Deposit>;
  /** The owner's signed new range: the epoch whose line is the first drawn from it. */
  reseal(c: SealContents, input: ResealInput): Promise<number>;
}

const opened = <T>(sealed: string, receiptSecret: string, guardId: string): T =>
  JSON.parse(new TextDecoder().decode(open(hexToBytes(receiptSecret), hexToBytes(sealed), guardId))) as T;

interface Answer {
  status?: string;
  refused?: string;
  sealed?: string;
  enc_pk?: string;
  error?: string;
  from_epoch?: number;
}

async function call(input: object): Promise<Answer> {
  const r = await fetch('/api/checker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const a = (await r.json()) as Answer;
  if (a.refused) throw new Refused(a.refused);
  if (!r.ok) throw new Refused(a.error ?? 'the guard did not answer');
  return a;
}

function deposit(c: SealContents, a: Answer): Deposit {
  const d = opened<{ deposit_address: string; amount: string; decimals: number }>(
    a.sealed ?? '',
    c.receipt_secret,
    c.guard_id,
  );
  return { address: d.deposit_address, amount: d.amount, decimals: d.decimals };
}

const toBalances = (b: { balances: { token: string; balance: string }[] }) =>
  Object.fromEntries(b.balances.map((x) => [x.token, x.balance]));

export const live: Backend = {
  async pubkey() {
    return (await call({ action: 'pubkey' })).enc_pk ?? '';
  },
  async create(input, receiptSecret) {
    const a = await call(input);
    const agent = a.sealed ? opened<{ agent: string }>(a.sealed, receiptSecret, input.guard_id).agent : null;
    return { agent };
  },
  async fund(c, source) {
    return deposit(c, await call({ action: 'fund', guard_id: c.guard_id, source_asset: source }));
  },
  async topup(c, input, source) {
    return deposit(c, await call({ ...input, source_asset: source }));
  },
  async reseal(_c, input) {
    return (await call(input)).from_epoch ?? 0;
  },
  async reserve(c) {
    const a = await call({ action: 'reserve', guard_id: c.guard_id });
    return toBalances(opened(a.sealed ?? '', c.receipt_secret, c.guard_id));
  },
  async freeze(input) {
    await call(input);
  },
  async close(input) {
    return (await call(input)).status === 'closed' ? 'closed' : 'pending';
  },
};

/** Demo only. Money arrives this long after an address is made. */
export const DEMO_ARRIVES_MS = 8_000;

function demoBackend(): Backend {
  const secret = random(32);
  // When each guard was funded, then topped up: the reserve shows one unit per funding that has arrived.
  const funded = new Map<string, number[]>();
  const epochs = new Map<string, number>();
  const sent = (id: string) => funded.set(id, [...(funded.get(id) ?? []), Date.now()]);
  const opens = <T>(guardId: string, hex: string): T =>
    JSON.parse(new TextDecoder().decode(open(secret, hexToBytes(hex), guardId))) as T;
  const sealFor = (c: { receipt_pk: string }, guardId: string, v: unknown) =>
    bytesToHex(seal(hexToBytes(c.receipt_pk.slice('x25519:'.length)), utf8ToBytes(JSON.stringify(v)), guardId, random));
  return {
    async pubkey() {
      return bytesToHex(x25519.getPublicKey(secret));
    },
    async create(input, receiptSecret) {
      await new Promise((r) => setTimeout(r, 900));
      const plain = open(secret, hexToBytes(input.enc_settings), input.guard_id);
      const p = JSON.parse(new TextDecoder().decode(plain)) as Pick<SealContents, 'settings' | 'salt' | 'owner_salt'>;
      const ok =
        commitment(p.settings, p.salt) === input.commitment &&
        ownerCommitment(p.settings.owner, p.owner_salt) === input.owner_commitment &&
        accountCommitment(p.settings.hl_address, p.settings.account_salt) === input.account_commitment;
      if (!ok) throw new Refused('settings do not match the public commitments');
      if (!p.settings.isolated) return { agent: null };
      const agent = `0x${bytesToHex(random(20))}`;
      const sealed = sealFor(p.settings, input.guard_id, { agent });
      return { agent: opened<{ agent: string }>(sealed, receiptSecret, input.guard_id).agent };
    },
    async fund(c) {
      sent(c.guard_id);
      return { address: `example-${bytesToHex(random(16))}`, amount: '0', decimals: 0 };
    },
    async reserve(c) {
      const arrived = (funded.get(c.guard_id) ?? []).filter((t) => Date.now() - t >= DEMO_ARRIVES_MS).length;
      return arrived ? { [c.settings.reserve_asset]: String(arrived) } : {};
    },
    async topup(c, input) {
      await new Promise((r) => setTimeout(r, 700));
      const { cents } = opens<{ cents: number }>(c.guard_id, input.enc_amount);
      if (!(cents >= 200)) throw new Refused('a top-up is $2 or more');
      sent(c.guard_id);
      return { address: `example-${bytesToHex(random(16))}`, amount: '0', decimals: 0 };
    },
    async reseal(c, input) {
      await new Promise((r) => setTimeout(r, 900));
      const r = opens<Pick<SealContents['settings'], 'preset' | 'line_range_pct' | 'target_range_pct'>>(
        c.guard_id,
        input.enc_range,
      );
      if (commitment({ ...c.settings, ...r }, c.salt) !== input.commitment)
        throw new Refused('the new range does not match the signed fingerprint');
      const epoch = (epochs.get(c.guard_id) ?? 0) + 1;
      epochs.set(c.guard_id, epoch);
      return epoch;
    },
    async freeze() {
      await new Promise((r) => setTimeout(r, 700));
    },
    async close() {
      await new Promise((r) => setTimeout(r, 900));
      return 'closed';
    },
  };
}

let demoInstance: Backend | null = null;
export const demo = (): Backend => (demoInstance ??= demoBackend());

// The public registry and the pokers, read and told directly from the browser, not through Ripcord's server.
const POKERS = (process.env.NEXT_PUBLIC_POKERS ?? '').split(',').filter(Boolean);

async function view<T>(method: string, args: object, contract = REGISTRY): Promise<T | null> {
  const r = await fetch(NEAR_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'ripcord',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const a = (await r.json()) as { result?: { result?: number[] } };
  return a.result?.result ? (JSON.parse(new TextDecoder().decode(new Uint8Array(a.result.result))) as T) : null;
}

export interface OnChainReceipt {
  public: { at_hour: number; credit_usd: number; latency_s: number; outcome: string };
  sealed: string;
  /** The exact figures and Hyperliquid transaction, only when the owner published proof. */
  proof?: { at: number; hl_credit_usd: number; hl_tx: string } | null;
}

export const readGuard = (id: string) => view<{ status: string }>('get_guard', { guard_id: id });
export const readReceipts = (id: string) =>
  view<OnChainReceipt[]>('get_receipts', { guard_id: id, from: 0, limit: 50 });
export const readStats = () => view<Stats>('stats', {});
/** Whether the guard's wallet is frozen: OutLayer keeps it with the wallet's policy. Null when it can't be read. */
export async function readFrozen(id: string): Promise<boolean | null> {
  const g = await view<{ wallet_pubkey: string }>('get_guard', { guard_id: id });
  if (!g) return null;
  const p = await view<{ frozen: boolean }>('get_wallet_policy', { wallet_pubkey: g.wallet_pubkey }, OUTLAYER);
  return p ? p.frozen : null;
}
export const readGuardHashes = (id: string) => view<OnChainGuard>('get_guard', { guard_id: id });
export const readArms = (id: string) => view<OnChainArm[]>('get_arms', { guard_id: id, from: 0, limit: 100 });
/** The build OutLayer runs for the checker: its project's active version, the wasm's sha256. */
export const readRunningBuild = async () =>
  (await view<{ active_version: string }>('get_project', { project_id: CHECKER_PROJECT }, OUTLAYER))?.active_version ??
  null;

/** Asks each poker to watch the guard: only the owner's device can prove the address (docs/SPEC.md §4). */
export async function watch(c: SealContents): Promise<void> {
  await Promise.allSettled(
    POKERS.map((p) =>
      fetch(`${p}/v1/watch/${c.guard_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hl_address: c.settings.hl_address, account_salt: c.settings.account_salt }),
      }),
    ),
  );
}

/** The most recent check any poker knows of, or null when none answers. */
export async function lastCheck(id: string): Promise<number | null> {
  const answers = await Promise.allSettled(
    POKERS.map(async (p) => {
      const r = await fetch(`${p}/v1/health/${id}`);
      return r.ok ? ((await r.json()) as { last_check_at: number | null }).last_check_at : null;
    }),
  );
  const times = answers.flatMap((a) => (a.status === 'fulfilled' && a.value ? [a.value] : []));
  return times.length ? Math.max(...times) : null;
}
