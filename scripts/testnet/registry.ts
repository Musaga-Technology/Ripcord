// Deploys the guard registry to NEAR testnet and checks it end to end against OutLayer's testnet: the registry
// becomes a real guard wallet's policy controller, an unlisted transfer is refused, the owner freezes with a
// NEP-413 signature, a frozen wallet refuses even an allowed transfer, a replayed signature is refused, the owner
// unfreezes, and closing deletes the wallet policy.
//
// Keys stay outside the repository and are never printed: the registry account's key in
// ~/.near-credentials/testnet/<account>.json (NEAR CLI format); the registry's name in ~/.ripcord/testnet.json.
//
// usage: corepack pnpm testnet:registry account | deploy | e2e
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import {
  accountCommitment,
  commitment,
  freezeMessage,
  newGuardId,
  nep413Hash,
  ownerCommitment,
  type GuardSettings,
} from '../../packages/shared/src/index';

const RPC = 'https://rpc.testnet.near.org';
const OUTLAYER = 'outlayer.testnet';
const OUTLAYER_API = 'https://testnet-api.outlayer.ai';
const ALLOWED = 'ripcord-test-allowed.testnet';
const WASM = 'target/wasm32-unknown-unknown/release/guard_registry.wasm';
const CREDS = join(homedir(), '.near-credentials', 'testnet');
const STATE = join(homedir(), '.ripcord', 'testnet.json');
const TGAS = 10n ** 12n;
const MILLINEAR = 10n ** 21n;

interface State {
  registry?: string;
}

/** A fresh OutLayer test wallet per run: a wallet that already has a policy would make register_guard an update. */
let wallet: { wallet_id: string; api_key: string } | null = null;

const random = (n: number) => new Uint8Array(randomBytes(n));
const bytesToHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const readState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
function saveState(s: State): void {
  mkdirSync(join(homedir(), '.ripcord'), { recursive: true, mode: 0o700 });
  writeFileSync(STATE, JSON.stringify(s, null, 1), { mode: 0o600 });
}

const provider = new JsonRpcProvider({ url: RPC });

/** The parts of a NEAR RPC transaction result this script reads. */
interface Outcome {
  id: string;
  outcome: { gas_burnt: number | string; status?: { Failure?: unknown } };
}
interface TxResult {
  transaction_outcome: Outcome;
  receipts_outcome: Outcome[];
}
/** OutLayer API answers: flat JSON objects of strings. */
type Body = Record<string, string | undefined>;

function registryAccount(): Account {
  const id = readState().registry;
  if (!id) throw new Error('no registry account yet: run `account` first');
  const creds = JSON.parse(readFileSync(join(CREDS, `${id}.json`), 'utf8'));
  return new Account(id, provider, creds.private_key as KeyPairString);
}

const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction<T & object>({ contractId, method, args, finality: 'final' } as never) as Promise<T>;

async function outlayer(method: 'GET' | 'POST', path: string, body?: unknown): Promise<[number, Body]> {
  const key = wallet?.api_key;
  const res = await fetch(OUTLAYER_API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return [res.status, JSON.parse(text)];
  } catch {
    return [res.status, { text }];
  }
}

/** Calls the registry and reports gas; returns the error text when the transaction or a receipt failed. */
async function call(acc: Account, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) {
  try {
    const r = (await acc.callFunctionRaw({
      contractId: acc.accountId,
      methodName,
      args,
      deposit,
      gas,
    })) as unknown as TxResult;
    const outcomes = [r.transaction_outcome, ...r.receipts_outcome];
    const tgas = outcomes.reduce((s: number, o) => s + Number(o.outcome.gas_burnt), 0) / 1e12;
    const failure = outcomes.map((o) => o.outcome.status?.Failure).find(Boolean);
    return { ok: !failure, tgas, tx: r.transaction_outcome.id, error: failure ? JSON.stringify(failure) : '' };
  } catch (e) {
    return { ok: false, tgas: 0, tx: '', error: String((e as Error).message ?? e).slice(0, 300) };
  }
}

let failures = 0;
function check(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures++;
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function createAccount(): Promise<void> {
  const s = readState();
  if (s.registry) return console.log(`registry account exists: ${s.registry}`);
  const kp = KeyPair.fromRandom('ed25519');
  const id = `ripcord-registry-${bytesToHex(random(4))}.testnet`;
  mkdirSync(CREDS, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(CREDS, `${id}.json`),
    JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }),
    { mode: 0o600 },
  );
  // NEAR's testnet faucet helper creates and funds a named account.
  const res = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  check(`created ${id} from the testnet faucet`, res.ok, res.ok ? '' : `${res.status}`);
  saveState({ ...s, registry: id });
}

async function deploy(): Promise<void> {
  const acc = registryAccount();
  const code = new Uint8Array(readFileSync(WASM));
  const r = (await acc.deployContract(code)) as unknown as TxResult;
  check(
    `deployed ${code.length.toLocaleString()} bytes to ${acc.accountId}`,
    !!r.transaction_outcome,
    r.transaction_outcome?.id,
  );
  try {
    await view(acc.accountId, 'config');
    console.log('already initialised');
  } catch {
    const init = await call(acc, 'new', { checker: acc.accountId, outlayer: OUTLAYER }, 0n, 30n * TGAS);
    check('initialised (checker: the deployer, for testing)', init.ok, init.error || `${init.tgas.toFixed(1)} Tgas`);
  }
}

/** The registry's checker is the enclave's account once `testnet:checker wire` ran: borrow the role, then give it back. */
async function e2e(): Promise<void> {
  const acc = registryAccount();
  const { checker } = await view<{ checker: string }>(acc.accountId, 'config');
  if (checker !== acc.accountId) await call(acc, 'set_checker', { checker: acc.accountId });
  try {
    await e2eSteps(acc);
  } finally {
    if (checker !== acc.accountId) {
      const back = await call(acc, 'set_checker', { checker });
      check('checker role handed back to the enclave account', back.ok, back.error);
    }
  }
}

async function e2eSteps(acc: Account): Promise<void> {
  const registry = acc.accountId;
  const [code, w] = await outlayer('POST', '/register', {});
  check('a fresh OutLayer testnet wallet', code === 200, `${code}`);
  if (!w.wallet_id || !w.api_key) throw new Error('OutLayer did not return a wallet');
  wallet = { wallet_id: w.wallet_id, api_key: w.api_key };

  // The guard wallet's policy, encrypted by OutLayer and signed by the wallet for this registry as `caller`.
  const policy = {
    rules: {
      transaction_types: ['transfer'],
      addresses: { mode: 'whitelist', list: [ALLOWED] },
      limits: { per_transaction: { native: (10n * MILLINEAR).toString() } },
    },
  };
  const [c1, enc] = await outlayer('POST', '/wallet/v1/encrypt-policy', { wallet_id: wallet!.wallet_id, ...policy });
  const [c2, sig] = await outlayer('POST', '/wallet/v1/sign-policy', {
    encrypted_data: enc.encrypted_base64,
    caller: registry,
  });
  check('policy encrypted and signed by the wallet for the registry', c1 === 200 && c2 === 200, `${c1}/${c2}`);
  const walletPubkey = `ed25519:${sig.public_key_hex}`;

  // A throwaway owner with a NEAR key (NEP-413), and the guard's hashes.
  const owner = KeyPair.fromRandom('ed25519');
  const ownerKey = owner.getPublicKey().toString();
  const ownerSalt = bytesToHex(random(32));
  const hl = '0x' + bytesToHex(random(20));
  const accountSalt = bytesToHex(random(32));
  const settings: GuardSettings = {
    owner: ownerKey,
    hl_address: hl,
    account_salt: accountSalt,
    preset: 'balanced',
    line_range_pct: [5, 8],
    target_range_pct: [9, 13],
    speed_aware: false,
    max_rescue_usd: 1500,
    budget_usd: 4000,
    reserve_asset: 'nep141:wrap.near',
    cooldown_s: 60,
    isolated: null,
    close_hint: null,
    receipt_pk: 'x25519:' + bytesToHex(random(32)),
    expires_at: ((BigInt(Date.now()) + 7n * 86_400_000n) * 1_000_000n).toString(),
  };
  const guardId = newGuardId(random);
  const reg = await call(
    acc,
    'register_guard',
    {
      guard_id: guardId,
      commitment: commitment(settings, bytesToHex(random(32))),
      owner_commitment: ownerCommitment(ownerKey, ownerSalt),
      account_commitment: accountCommitment(hl, accountSalt),
      expires_at: settings.expires_at,
      wallet_pubkey: walletPubkey,
      encrypted_policy: enc.encrypted_base64,
      wallet_signature: sig.signature_hex,
    },
    30n * MILLINEAR,
    200n * TGAS,
  );
  check(`register_guard ${guardId}`, reg.ok, reg.error || `${reg.tgas.toFixed(1)} Tgas, tx ${reg.tx}`);
  const wp = await view<{ owner: string; frozen: boolean } | null>(OUTLAYER, 'get_wallet_policy', {
    wallet_pubkey: walletPubkey,
  });
  check('the registry is the wallet policy controller on OutLayer', wp?.owner === registry, `owner ${wp?.owner}`);
  const guard = await view<{ status: string } | null>(registry, 'get_guard', { guard_id: guardId });
  check('the guard is stored as hashes, status Pending', guard?.status === 'Pending');

  const st = await call(acc, 'set_status', { guard_id: guardId, status: 'Guarding' });
  check('status Guarding', st.ok, st.error);

  await outlayer('POST', '/wallet/v1/invalidate-cache', { wallet_id: wallet!.wallet_id });
  const [c3, t1] = await outlayer('POST', '/wallet/v1/transfer', {
    chain: 'near',
    to: 'someone-else.testnet',
    amount: '1000',
  });
  check(
    'an unlisted recipient is refused (T-SEC-03)',
    c3 === 403 && t1?.error === 'policy_denied',
    `${c3} ${t1?.error}`,
  );

  const signed = (frozen: boolean, nonce: string) => {
    const msg = freezeMessage(guardId, nonce, frozen);
    const signature = owner.sign(nep413Hash(msg, nonce, registry)).signature;
    return { guard_id: guardId, owner: ownerKey, owner_salt: ownerSalt, sig: bytesToHex(signature), nonce };
  };
  const nonce = bytesToHex(random(8));
  const fr = await call(acc, 'freeze_guard', signed(true, nonce));
  check('the owner freezes with one NEP-413 signature', fr.ok, fr.error || `${fr.tgas.toFixed(1)} Tgas, tx ${fr.tx}`);
  const frozen = await view<{ frozen: boolean }>(OUTLAYER, 'get_wallet_policy', { wallet_pubkey: walletPubkey });
  check('OutLayer shows the wallet frozen', frozen?.frozen === true);
  await outlayer('POST', '/wallet/v1/invalidate-cache', { wallet_id: wallet!.wallet_id });
  const [c4, t2] = await outlayer('POST', '/wallet/v1/transfer', { chain: 'near', to: ALLOWED, amount: '1000' });
  check(
    'a frozen wallet refuses even an allowed recipient (T-SEC-05)',
    c4 === 403 && t2?.error === 'wallet_frozen',
    `${c4} ${t2?.error}`,
  );

  const replay = await call(acc, 'freeze_guard', signed(true, nonce));
  check(
    'the same signature again is refused (T-SEC-06)',
    !replay.ok && replay.error.includes('nonce already used'),
    replay.ok ? 'accepted' : 'nonce already used',
  );

  const un = await call(acc, 'unfreeze_guard', signed(false, bytesToHex(random(8))));
  const after = await view<{ frozen: boolean }>(OUTLAYER, 'get_wallet_policy', { wallet_pubkey: walletPubkey });
  check('the owner unfreezes', un.ok && after?.frozen === false, un.error);

  const cl = await call(acc, 'close', { guard_id: guardId });
  const has = await view<boolean>(OUTLAYER, 'has_wallet_policy', { wallet_pubkey: walletPubkey });
  check('close deletes the wallet policy', cl.ok && has === false, cl.error || `${cl.tgas.toFixed(1)} Tgas`);
}

const stage = process.argv[2];
const run = { account: createAccount, deploy, e2e }[stage as 'e2e'];
if (!run) {
  console.error('usage: corepack pnpm testnet:registry account | deploy | e2e');
  process.exit(2);
}
run()
  .then(() => process.exit(failures ? 1 : 0))
  .catch((e) => {
    console.error('error:', String(e?.message ?? e).slice(0, 300));
    process.exit(1);
  });
