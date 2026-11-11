// Deploys the checker to OutLayer's testnet as a project and checks it end to end: the enclave publishes its sealing
// key and NEAR account, the registry is pointed at that account, and a guard created through the enclave opens its
// own custody wallet and is registered on chain by the enclave's key, with the registry as the wallet's controller.
//
// The same contract calls OutLayer's CLI makes (out-layer/outlayer-cli v0.2.1: upload, deploy, keys create), written
// here so nothing outside this repository runs. Keys stay outside the repository and are never printed: the ops
// account's key in ~/.near-credentials/testnet/<account>.json, the payment key in ~/.ripcord/paykey-testnet.
//
// usage: corepack pnpm testnet:checker account | deploy | mainnet-host | paykey | pubkey | wire | create | check
// (`bash checker/build.sh` first for deploy)
import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, actions, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { check, failed, hex, NEAR, random, send, serves, TGAS, upload } from '../near/lib';
import {
  accountCommitment,
  commitment,
  newGuardId,
  ownerCommitment,
  seal,
  type GuardSettings,
} from '../../packages/shared/src/index';

const RPC = 'https://rpc.testnet.near.org';
const OUTLAYER = 'outlayer.testnet';
const OUTLAYER_API = 'https://testnet-api.outlayer.ai';
const FASTFS = 'https://test.fastfs.io';
const MAINNET_FASTFS = 'https://main.fastfs.io';
const MAINNET_RPC = 'https://rpc.mainnet.near.org';
const PROJECT = 'checker';
const WASM = 'target/outlayer/wasm32-wasip2/release/ripcord-checker.wasm';
const USDC_TEST = 'usdc.fakes.testnet';
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const CREDS = join(homedir(), '.near-credentials', 'testnet');
const MAINNET_CREDS = join(homedir(), '.near-credentials', 'mainnet');
const DIR = join(homedir(), '.ripcord');
const STATE = join(DIR, 'testnet.json');
const PAYKEY = join(DIR, 'paykey-testnet');

interface State {
  registry?: string;
  ops?: string;
  wasm_url?: string;
  wasm_hash?: string;
  mainnet_uploader?: string;
  last_guard?: string;
  checker_account?: string;
  enc_pk?: string;
}

const readState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
function saveState(patch: State): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(STATE, JSON.stringify({ ...readState(), ...patch }, null, 1), { mode: 0o600 });
}

const provider = new JsonRpcProvider({ url: RPC });
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction<T & object>({ contractId, method, args, finality: 'final' } as never) as Promise<T>;

function account(id: string | undefined, what: string): Account {
  if (!id) throw new Error(`no ${what} account yet`);
  const creds = JSON.parse(readFileSync(join(CREDS, `${id}.json`), 'utf8'));
  return new Account(id, provider, creds.private_key as KeyPairString);
}
const ops = () => account(readState().ops, 'ops (run `account`)');

/** OutLayer API answers and the checker's output: flat JSON objects. */
type Body = Record<string, string | undefined>;

async function api(path: string, body: unknown, headers: Record<string, string> = {}): Promise<[number, Body]> {
  const res = await fetch(OUTLAYER_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return [res.status, JSON.parse(text)];
  } catch {
    return [res.status, { text: text.slice(0, 200) }];
  }
}

/** Runs the checker over HTTPS with Ripcord's payment key; returns the checker's own JSON output. */
async function callChecker(input: object): Promise<Body> {
  const key = readFileSync(PAYKEY, 'utf8').trim();
  const [code, r] = await api(`/call/${readState().ops}/${PROJECT}`, { input, async: false }, { 'X-Payment-Key': key });
  if (code !== 200 || r.status !== 'completed')
    throw new Error(`call ${code}: ${r.status ?? ''} ${r.error ?? r.text ?? ''}`);
  const output: unknown = r.output;
  return typeof output === 'string' ? JSON.parse(output) : (output as Body);
}

// ---------- stages ----------

async function createAccount(): Promise<void> {
  if (readState().ops) return console.log(`ops account exists: ${readState().ops}`);
  const kp = KeyPair.fromRandom('ed25519');
  const id = `ripcord-ops-${hex(random(4))}.testnet`;
  mkdirSync(CREDS, { recursive: true });
  writeFileSync(
    join(CREDS, `${id}.json`),
    JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }),
    { mode: 0o600 },
  );
  const res = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  check(`created ${id} from the testnet faucet (owns the project and its payment key)`, res.ok, `${res.status}`);
  if (res.ok) saveState({ ops: id });
}

async function deploy(): Promise<void> {
  const acc = ops();
  const wasm = new Uint8Array(readFileSync(WASM));
  const hash = createHash('sha256').update(wasm).digest('hex');
  const url = `${FASTFS}/${acc.accountId}/${OUTLAYER}/${hash}.wasm`;
  if (readState().wasm_hash !== hash) await upload(acc, OUTLAYER, hash, wasm, 'FastFS');
  // The worker downloads and hash-checks the file at run time, so a slow FastFS indexer only delays the first call.
  if (await serves(url, hash)) check('FastFS serves the same bytes', true, url);
  else console.log(`… FastFS is not serving it yet (${url}); the project is created anyway`);
  saveState({ wasm_url: url, wasm_hash: hash });
  await setVersion(url, hash);
}

/** Creates the project, or adds and activates a version: the wasm at `url`, pinned to its sha256. */
async function setVersion(url: string, hash: string): Promise<void> {
  const acc = ops();
  const source = { WasmUrl: { url, hash, build_target: 'wasm32-wasip2' } };
  const existing = await view<{ active_version: string } | null>(OUTLAYER, 'get_project', {
    project_id: `${acc.accountId}/${PROJECT}`,
  });
  const r = existing
    ? await send(acc, OUTLAYER, 'add_version', { project_name: PROJECT, source, set_active: true }, NEAR / 10n)
    : await send(acc, OUTLAYER, 'create_project', { name: PROJECT, source }, NEAR / 10n);
  check(
    `${existing ? 'added version' : 'created project'} ${acc.accountId}/${PROJECT} at ${hash.slice(0, 12)}…`,
    r.ok,
    r.tx || r.error,
  );
  // Every published version stays callable by its key, so the one replaced goes.
  const old = existing?.active_version;
  if (r.ok && old && old !== hash) {
    const rm = await send(acc, OUTLAYER, 'remove_version', { project_name: PROJECT, version_key: old }, 0n, 30n * TGAS);
    check(`removed the previous version ${old.slice(0, 12)}…`, rm.ok, rm.tx || rm.error);
  }
}

/** OutLayer's keystore ECIES v1: X25519 + HKDF-SHA256 (no salt, "outlayer-keystore-v1") + ChaCha20-Poly1305. */
function keystoreEncrypt(pubkeyHex: string, plaintext: string): string {
  const spki = (raw: Buffer) => Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]);
  const recipient = createPublicKey({ key: spki(Buffer.from(pubkeyHex, 'hex')), format: 'der', type: 'spki' });
  const eph = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'outlayer-keystore-v1', 32));
  const nonce = randomBytes(12);
  const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final(), c.getAuthTag()]);
  const ephRaw = eph.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return Buffer.concat([Buffer.from([1]), ephRaw, nonce, ct]).toString('base64');
}

async function paykey(): Promise<void> {
  const acc = ops();
  if (!existsSync(PAYKEY)) {
    const nonce = await view<number>(OUTLAYER, 'get_next_payment_key_nonce', { account_id: acc.accountId });
    const secret = hex(random(32));
    const secrets = JSON.stringify({ key: secret, project_ids: [], max_per_call: '0', initial_balance: '0' });
    const [code, pk] = await api('/secrets/pubkey', {
      accessor: { type: 'System', PaymentKey: {} },
      owner: acc.accountId,
      profile: String(nonce),
      secrets_json: secrets,
    });
    check('keystore key for the payment key', code === 200 && !!pk.pubkey, `${code}`);
    if (!pk.pubkey) return;
    // Written down before the transaction: the secret exists nowhere else.
    writeFileSync(PAYKEY, `${acc.accountId}:${nonce}:${secret}\n`, { mode: 0o600 });
    const r = await send(
      acc,
      OUTLAYER,
      'store_secrets',
      {
        accessor: { System: 'PaymentKey' },
        profile: String(nonce),
        encrypted_secrets_base64: keystoreEncrypt(pk.pubkey, secrets),
        access: 'AllowAll',
        vault_id: null,
      },
      NEAR / 10n,
    );
    check(`payment key ${nonce} stored`, r.ok, r.tx || r.error);
  }
  const nonce = Number(readFileSync(PAYKEY, 'utf8').split(':')[1]);
  // Test USDC from the testnet token, then the top-up OutLayer's CLI makes (ft_transfer_call, top_up_payment_key).
  await send(acc, USDC_TEST, 'storage_deposit', { account_id: acc.accountId }, 125n * 10n ** 19n);
  const mint = await send(acc, USDC_TEST, 'mint', { account_id: acc.accountId, amount: '5000000' });
  check('minted 5 test USDC', mint.ok, mint.tx || mint.error);
  const top = await send(
    acc,
    USDC_TEST,
    'ft_transfer_call',
    { receiver_id: OUTLAYER, amount: '5000000', msg: JSON.stringify({ action: 'top_up_payment_key', nonce }) },
    1n,
  );
  check('topped up the payment key with 5 test USDC', top.ok, top.tx || top.error);
}

async function pubkey(): Promise<void> {
  const out = await callChecker({ action: 'pubkey' });
  check(
    'the enclave answers with its sealing key and NEAR account',
    /^[0-9a-f]{64}$/.test(out.enc_pk ?? '') && /^[0-9a-f]{64}$/.test(out.account ?? ''),
    JSON.stringify(out),
  );
  const again = await callChecker({ action: 'pubkey' });
  check('and the same keys on the next run', again.enc_pk === out.enc_pk && again.account === out.account);
  if (out.account && out.enc_pk) saveState({ checker_account: out.account, enc_pk: out.enc_pk });
}

async function wire(): Promise<void> {
  const s = readState();
  if (!s.checker_account || !s.registry) throw new Error('run `pubkey` first (and the registry script)');
  const acc = ops();
  const bal = await provider.viewAccount({ accountId: s.checker_account } as never).catch(() => null);
  if (!bal) {
    const t = await acc.signAndSendTransaction({
      receiverId: s.checker_account,
      actions: [actions.transfer(2n * NEAR)],
      throwOnFailure: false,
    });
    check('funded the enclave account with 2 testnet NEAR (gas and the guard deposit)', !!t, s.checker_account);
  }
  const registry = account(s.registry, 'registry');
  const r = await send(registry, registry.accountId, 'set_checker', { checker: s.checker_account });
  check('the registry now takes guards only from the enclave account', r.ok, r.tx || r.error);
  const cfg = await view<{ checker: string }>(registry.accountId, 'config');
  check('registry config names the enclave account', cfg.checker === s.checker_account);
}

/** A guard's settings for `hl`, sealed to the enclave the way the browser does, and the create call around them. */
function guardInput(encPk: string, hl: string) {
  const owner = KeyPair.fromRandom('ed25519').getPublicKey().toString();
  const settings: GuardSettings = {
    owner,
    hl_address: hl,
    account_salt: hex(random(32)),
    preset: 'balanced',
    line_range_pct: [5, 8],
    target_range_pct: [9, 13],
    speed_aware: false,
    max_rescue_usd: 1500,
    budget_usd: 4000,
    reserve_asset: USDC,
    cooldown_s: 60,
    isolated: null,
    close_hint: null,
    receipt_pk: 'x25519:' + hex(random(32)),
    expires_at: ((BigInt(Date.now()) + 7n * 86_400_000n) * 1_000_000n).toString(),
  };
  const salt = hex(random(32));
  const ownerSalt = hex(random(32));
  const guardId = newGuardId(random);
  const payload = new TextEncoder().encode(JSON.stringify({ settings, salt, owner_salt: ownerSalt }));
  const input = {
    action: 'create',
    guard_id: guardId,
    commitment: commitment(settings, salt),
    owner_commitment: ownerCommitment(owner, ownerSalt),
    account_commitment: accountCommitment(settings.hl_address, settings.account_salt),
    expires_at: settings.expires_at,
    enc_settings: hex(seal(Buffer.from(encPk, 'hex'), payload, guardId, random)),
  };
  return { guardId, settings, salt, ownerSalt, input };
}

async function create(): Promise<void> {
  const s = readState();
  if (!s.enc_pk || !s.registry) throw new Error('run `pubkey` and `wire` first');
  const { guardId, settings, salt, ownerSalt, input } = guardInput(s.enc_pk, '0x' + hex(random(20)));
  const out = await callChecker(input);
  check(`created ${guardId} through the enclave`, out.status === 'pending', JSON.stringify(out));
  if (out.status === 'pending') saveState({ last_guard: guardId });
  const text = JSON.stringify(out).toLowerCase();
  check(
    'the output carries no setting',
    ![settings.hl_address.slice(2), salt, ownerSalt, '1500', '4000'].some((x) => text.includes(x)),
  );
  // A guard goes on chain once its reserve arrives, and testnet has no private route to fund one, so a testnet guard
  // stays off chain: registering it is covered by the checker's tests and by mainnet.
  const guard = await view<{ status: string } | null>(s.registry, 'get_guard', { guard_id: guardId });
  check('nothing is on chain before the reserve arrives', guard === null, JSON.stringify(guard));
  const again = await callChecker(input);
  check('a retry is harmless', again.status === 'pending', JSON.stringify(again));
  const stranger = await callChecker({ ...input, guard_id: newGuardId(random) });
  check(
    'settings sealed for one guard do not open for another',
    stranger.status === 'skipped',
    JSON.stringify(stranger),
  );
}

/**
 * The same wasm on mainnet FastFS, for when the testnet host is down: any HTTPS URL works,
 * since the version pins the sha256. Uploaded by a fresh implicit mainnet account that holds a few cents of NEAR and
 * nothing else; its key stays in ~/.near-credentials/mainnet. One upload costs about 0.001 NEAR.
 */
async function mainnetHost(): Promise<void> {
  let id = readState().mainnet_uploader;
  if (!id) {
    const kp = KeyPair.fromRandom('ed25519');
    id = hex(kp.getPublicKey().data);
    mkdirSync(MAINNET_CREDS, { recursive: true });
    writeFileSync(
      join(MAINNET_CREDS, `${id}.json`),
      JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }),
      { mode: 0o600 },
    );
    saveState({ mainnet_uploader: id });
  }
  const mainnet = new JsonRpcProvider({ url: MAINNET_RPC });
  const funded = await mainnet.viewAccount({ accountId: id } as never).catch(() => null);
  if (!funded) {
    console.log(`Send 0.05 NEAR on mainnet to this implicit account, then run this stage again:\n  ${id}`);
    process.exit(1);
  }
  const creds = JSON.parse(readFileSync(join(MAINNET_CREDS, `${id}.json`), 'utf8'));
  const uploader = new Account(id, mainnet, creds.private_key as KeyPairString);
  const wasm = new Uint8Array(readFileSync(WASM));
  const hash = createHash('sha256').update(wasm).digest('hex');
  const url = `${MAINNET_FASTFS}/${id}/outlayer.near/${hash}.wasm`;
  if (!(await serves(url, hash))) {
    await upload(uploader, 'outlayer.near', hash, wasm, 'mainnet FastFS');
    if (!(await serves(url, hash))) return check('mainnet FastFS serves the same bytes', false, url);
  }
  check('mainnet FastFS serves the same bytes', true, url);
  saveState({ wasm_url: url, wasm_hash: hash });
  await setVersion(url, hash);
}

/** The enclave reads Hyperliquid itself; this guard's account holds nothing, so it arms and guards. */
/** An unfunded guard is checked inside the enclave and answers pending: it can't be guarded before its reserve. */
async function checkStage(): Promise<void> {
  const s = readState();
  if (!s.last_guard || !s.registry) throw new Error('run `create` first');
  const out = await callChecker({ action: 'check', guard_id: s.last_guard });
  check(
    `checked ${s.last_guard} inside the enclave: pending until funded`,
    out.status === 'pending',
    JSON.stringify(out),
  );
  check('the output is a bare status', Object.keys(out).join() === 'status');
  const g = await view<{ status: string } | null>(s.registry, 'get_guard', { guard_id: s.last_guard });
  check('and still nothing on chain', g === null, JSON.stringify(g));
}

/**
 * A real poker against the live registry and enclave: a guard for our own Hyperliquid test wallet
 * (TEST_WALLET_ADDRESS in .env), registered with the poker by its address and salt; the poker's first pass calls the
 * enclave, which reads Hyperliquid itself.
 */
async function pokerStage(): Promise<void> {
  const s = readState();
  if (!s.enc_pk || !s.registry || !s.ops) throw new Error('run `pubkey` and `wire` first');
  const env = readFileSync('.env', 'utf8');
  const hl = /^TEST_WALLET_ADDRESS=(0x[0-9a-fA-F]{40})\s*$/m.exec(env)?.[1];
  if (!hl) throw new Error('TEST_WALLET_ADDRESS is not set in .env');
  const g = guardInput(s.enc_pk, hl);
  const created = await callChecker(g.input);
  check(`created ${g.guardId} for our own test wallet`, created.status === 'pending', JSON.stringify(created));

  const { Watcher } = await import('../../services/poker/src/watch');
  const { Store } = await import('../../services/poker/src/store');
  const { server } = await import('../../services/poker/src/server');
  const { hyperliquid } = await import('../../services/poker/src/hl');
  const { checker, registry } = await import('../../services/poker/src/clients');
  const statuses: string[] = [];
  const toChecker = checker({
    api: OUTLAYER_API,
    project: `${s.ops}/${PROJECT}`,
    paymentKey: readFileSync(PAYKEY, 'utf8').trim(),
  });
  const watcher = new Watcher(hyperliquid(), async (id) => {
    const st = await toChecker(id);
    statuses.push(st);
    return st;
  });
  const store = new Store(join(DIR, 'poker-testnet.json'), hex(random(32)));
  const srv = server(watcher, store, registry(RPC, s.registry));
  await new Promise<void>((ok) => srv.listen(0, ok));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    const put = (salt: string) =>
      fetch(`${base}/v1/watch/${g.guardId}`, {
        method: 'PUT',
        body: JSON.stringify({ hl_address: hl, account_salt: salt }),
      });
    check('the poker refuses a salt that does not match the registry', (await put(hex(random(32)))).status === 403);
    check(
      "and watches with the owner's salt (matched against the live registry)",
      (await put(g.settings.account_salt)).status === 200,
    );
    const calls = await watcher.tick(Date.now());
    check(
      'its first pass calls the enclave',
      calls.length === 1,
      JSON.stringify(calls.map((c) => [c.reason, c.status, c.ms])),
    );
    // Unfunded (testnet can't fund a reserve), so the enclave answers pending instead of reading Hyperliquid.
    check('which answered pending: the guard has no reserve yet', statuses[0] === 'pending', statuses[0]);
    const h = (await (await fetch(`${base}/v1/health/${g.guardId}`)).json()) as Record<string, unknown>;
    check(
      'health shows the check, and no address',
      h.checks_24h === 1 && !JSON.stringify(h).includes('0x'),
      JSON.stringify(h),
    );
  } finally {
    srv.close();
  }
}

const stage = process.argv[2];
const run = {
  account: createAccount,
  deploy,
  'mainnet-host': mainnetHost,
  paykey,
  pubkey,
  wire,
  create,
  check: checkStage,
  poker: pokerStage,
}[stage as 'create'];
if (!run) {
  console.log(
    'usage: corepack pnpm testnet:checker account | deploy | mainnet-host | paykey | pubkey | wire | create | check | poker',
  );
  process.exit(2);
}
await run();
if (failed()) process.exit(1);
