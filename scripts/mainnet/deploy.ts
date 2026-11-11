// Puts Ripcord on NEAR mainnet: the guard registry on its own named account, the checker as that account's OutLayer
// project, and the enclave's account funded and named the registry's checker. The same calls the testnet scripts
// make and check, against mainnet. `plan` spends nothing: it reads the chain and says what each stage would spend.
// Every other stage checks its balance before it signs.
//
// One account is funded by hand: the deploy account, an implicit account that also uploads the checker to FastFS.
// It creates ripcord-registry.near with the registry's storage and float. That account then owns the contract and
// the checker project, so one key controls both until the registry is locked.
//
// Keys stay outside the repository and are never printed: ~/.near-credentials/mainnet/<account>.json (NEAR CLI
// format); the payment key that pays for enclave runs is OUTLAYER_PAYMENT_KEY in .env. What the stages learn (the
// enclave's account and sealing key, the published wasm) is kept in ~/.ripcord/mainnet.json.
//
// usage: corepack pnpm mainnet:deploy plan | registry | checker | pubkey | wire | status
// (`bash contracts/guard-registry/build.sh` and `bash checker/build.sh mainnet` first)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, actions, baseEncode, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { check, failed, MILLINEAR, near, send, sendActions, serves, TGAS, upload } from '../near/lib';

const RPC = 'https://free.rpc.fastnear.com';
const OUTLAYER = 'outlayer.near';
const OUTLAYER_API = 'https://api.outlayer.ai';
const FASTFS = 'https://main.fastfs.io';
const REGISTRY = 'ripcord-registry.near';
const PROJECT = 'checker';
const REGISTRY_WASM = 'target/near/guard_registry.wasm';
const CHECKER_WASM = 'target/outlayer-mainnet/wasm32-wasip2/release/ripcord-checker.wasm';
const CREDS = join(homedir(), '.near-credentials', 'mainnet');
const DIR = join(homedir(), '.ripcord');
const STATE = join(DIR, 'mainnet.json');

/** NEAR locks 1 NEAR per 100 KB an account stores (storage staking). */
const PER_BYTE = 10n ** 19n;
/** The registry account's own record and key, the contract's state after `new`, and the deploy and admin gas. */
const REGISTRY_EXTRA = 15n * MILLINEAR;
/** Attached to create_project or add_version; OutLayer keeps the project's storage (≈ 0.0064) and refunds the rest. */
const PROJECT_DEPOSIT = 20n * MILLINEAR;
/**
 * NEAR holds a call's attached gas up front at a cautious price, about 10× today's (100 Tgas held ~0.1 NEAR on Nov 11),
 * and refuses a call that would dip into the storage deposit; registering a project needs far less than 100 Tgas.
 */
const PROJECT_GAS = 50n * TGAS;
/** The enclave's account: gas, and 0.03 NEAR per guard it registers (OutLayer keeps ≈ 0.012, the rest returns). */
const ENCLAVE_FUND = 80n * MILLINEAR;
/** Kept on the deploy account after it creates the registry: the FastFS upload and its own gas. */
const DEPLOYER_KEEP = 10n * MILLINEAR;

interface State {
  deployer?: string;
  wasm_url?: string;
  wasm_hash?: string;
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

interface AccountView {
  amount: string;
  storage_usage: number;
  code_hash: string;
}
const viewAccount = (accountId: string) =>
  provider.viewAccount({ accountId, finality: 'final' } as never).catch(() => null) as Promise<AccountView | null>;
/** What an account can spend: its balance minus what its storage locks. */
const spendable = (a: AccountView | null) => (a ? BigInt(a.amount) - BigInt(a.storage_usage) * PER_BYTE : 0n);

const credsPath = (id: string) => join(CREDS, `${id}.json`);
function signer(id: string): Account {
  const creds = JSON.parse(readFileSync(credsPath(id), 'utf8'));
  return new Account(id, provider, creds.private_key as KeyPairString);
}

/** The implicit account that uploaded the checker to mainnet FastFS in October (`testnet:checker mainnet-host`). */
function deployer(): Account {
  let id = readState().deployer;
  if (!id) {
    const testnet = join(DIR, 'testnet.json');
    id = existsSync(testnet) ? (JSON.parse(readFileSync(testnet, 'utf8')).mainnet_uploader as string) : undefined;
    if (!id || !existsSync(credsPath(id))) throw new Error('no deploy account: run `testnet:checker mainnet-host`');
    saveState({ deployer: id });
  }
  return signer(id);
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const readWasm = (path: string) => (existsSync(path) ? new Uint8Array(readFileSync(path)) : null);

/** The checker binary, if it was built for mainnet: the registry and OutLayer compiled in are mainnet's. */
function mainnetChecker(): Uint8Array | null {
  const wasm = readWasm(CHECKER_WASM);
  if (!wasm) return null;
  const text = Buffer.from(wasm);
  // Hosts can't tell (the embedded manifest names both networks'); the registry compiled in can.
  return text.includes(REGISTRY) && !text.includes('ripcord-registry-db06d339.testnet') ? wasm : null;
}

/** What the registry account needs when it is created: the contract's storage, its state and gas, and the floats. */
const registryFund = (code: Uint8Array) =>
  BigInt(code.length) * PER_BYTE + REGISTRY_EXTRA + PROJECT_DEPOSIT + ENCLAVE_FUND;

/** OutLayer's payment key (owner:nonce:secret) from .env; it pays $0.001 per enclave run. */
function paymentKey(): string {
  const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const key = /^OUTLAYER_PAYMENT_KEY=([a-z0-9._-]+:\d+:[0-9a-f]{64})\s*$/m.exec(env)?.[1];
  if (!key) throw new Error('OUTLAYER_PAYMENT_KEY is not set in .env');
  return key;
}

type Body = Record<string, string | undefined>;
/** Runs the mainnet checker over HTTPS with the payment key; returns the checker's own JSON output. */
async function callChecker(input: object): Promise<Body> {
  const res = await fetch(`${OUTLAYER_API}/call/${REGISTRY}/${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Payment-Key': paymentKey() },
    body: JSON.stringify({ input, async: false }),
  });
  const text = await res.text();
  let r: Body & { output?: unknown };
  try {
    r = JSON.parse(text);
  } catch {
    throw new Error(`call ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status !== 200 || r.status !== 'completed')
    throw new Error(`call ${res.status}: ${r.status ?? ''} ${r.error ?? ''}`);
  return typeof r.output === 'string' ? JSON.parse(r.output) : (r.output as Body);
}

// ---------- stages ----------

/** Reads the chain and the local builds; signs nothing. */
async function plan(): Promise<void> {
  const dep = deployer();
  const code = readWasm(REGISTRY_WASM);
  const checker = mainnetChecker();
  const [d, reg] = await Promise.all([viewAccount(dep.accountId), viewAccount(REGISTRY)]);
  const ours = existsSync(credsPath(REGISTRY));

  check(`registry built (${REGISTRY_WASM})`, !!code, code ? `${code.length.toLocaleString()} bytes` : 'run build.sh');
  check(
    `checker built for mainnet (${CHECKER_WASM})`,
    !!checker,
    checker ? `sha256 ${sha256(checker).toString('hex')}` : 'run `bash checker/build.sh mainnet`',
  );
  check(
    `${REGISTRY} is free, or ours`,
    !reg || ours,
    reg ? `exists, ${ours ? 'key on this machine' : 'NOT ours'}` : 'free',
  );
  if (!code) return;
  const hash = checker && sha256(checker).toString('hex');
  const uploaded = !!hash && (await serves(`${FASTFS}/${dep.accountId}/${OUTLAYER}/${hash}.wasm`, hash, 1));

  const fund = registryFund(code);
  const needs = reg ? 0n : fund + DEPLOYER_KEEP;
  const has = spendable(d);
  console.log(`\ndeploy account ${dep.accountId}: ${near(has)} NEAR spendable`);
  console.log(`  creates ${REGISTRY} with ${near(fund)} NEAR:`);
  console.log(`    ${near(BigInt(code.length) * PER_BYTE)}  contract storage (${code.length.toLocaleString()} bytes)`);
  console.log(`    ${near(REGISTRY_EXTRA)}  account, state after \`new\`, deploy and admin gas`);
  console.log(`    ${near(PROJECT_DEPOSIT)}  checker project deposit (≈ 0.0064 kept, the rest refunded)`);
  console.log(`    ${near(ENCLAVE_FUND)}  the enclave's account: gas and guard registrations`);
  console.log(`  keeps ${near(DEPLOYER_KEEP)} for the FastFS upload${uploaded ? ' (already served)' : ''} and gas`);
  if (needs > has) console.log(`\nSend ${near(needs - has)} NEAR to ${dep.accountId}, then run \`registry\`.`);
  else
    check('the deploy account can pay for every stage', true, reg ? 'registry exists' : `${near(has - needs)} spare`);
}

/** Creates ripcord-registry.near from the deploy account, deploys the packed contract and initialises it. */
async function registry(): Promise<void> {
  const code = readWasm(REGISTRY_WASM);
  if (!code) throw new Error('run `bash contracts/guard-registry/build.sh` first');
  const codeHash = baseEncode(sha256(code));
  let reg = await viewAccount(REGISTRY);
  if (!reg) {
    const dep = deployer();
    const fund = registryFund(code);
    const has = spendable(await viewAccount(dep.accountId));
    if (has < fund + DEPLOYER_KEEP)
      return check('the deploy account holds enough', false, `${near(has)} of ${near(fund + DEPLOYER_KEEP)} NEAR`);
    // A key left by a creation that failed is reused: the account doesn't exist, so nothing else holds it.
    let kp: KeyPair;
    if (existsSync(credsPath(REGISTRY))) {
      kp = KeyPair.fromString(JSON.parse(readFileSync(credsPath(REGISTRY), 'utf8')).private_key as KeyPairString);
    } else {
      kp = KeyPair.fromRandom('ed25519');
      mkdirSync(CREDS, { recursive: true, mode: 0o700 });
      // Written down before the transaction: the key exists nowhere else.
      writeFileSync(
        credsPath(REGISTRY),
        JSON.stringify({ account_id: REGISTRY, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }),
        { mode: 0o600 },
      );
    }
    // NEAR's `near` account creates .near names for anyone (linkdrop's create_account; refunds if it fails).
    const r = await send(
      dep,
      'near',
      'create_account',
      { new_account_id: REGISTRY, new_public_key: kp.getPublicKey().toString() },
      fund,
      50n * TGAS,
    );
    reg = await viewAccount(REGISTRY);
    check(`created ${REGISTRY} with ${near(fund)} NEAR`, r.ok && !!reg, r.tx || r.error);
    if (!reg) return;
  }
  const acc = signer(REGISTRY);
  if (reg.code_hash !== codeHash) {
    const d = await sendActions(acc, REGISTRY, [actions.deployContract(code)]);
    check(`deployed ${code.length.toLocaleString()} bytes`, d.ok, d.tx || d.error);
    reg = await viewAccount(REGISTRY);
  }
  check('the code on chain is this build', reg?.code_hash === codeHash, `code hash ${reg?.code_hash}`);
  const cfg = await view<{ checker: string }>(REGISTRY, 'config').catch(() => null);
  if (!cfg) {
    // The registry is its own checker until `wire` names the enclave's account.
    const init = await send(acc, REGISTRY, 'new', { checker: REGISTRY, outlayer: OUTLAYER }, 0n, 30n * TGAS);
    check(`initialised (OutLayer: ${OUTLAYER})`, init.ok, init.tx || init.error);
  } else console.log(`already initialised (checker: ${cfg.checker})`);
}

/** Publishes the mainnet checker to FastFS and makes it ripcord-registry.near/checker's active version. */
async function checkerStage(): Promise<void> {
  const wasm = mainnetChecker();
  if (!wasm) throw new Error('build the mainnet checker first: bash checker/build.sh mainnet');
  const hash = sha256(wasm).toString('hex');
  const dep = deployer();
  const url = `${FASTFS}/${dep.accountId}/${OUTLAYER}/${hash}.wasm`;
  if (!(await serves(url, hash, 1))) {
    await upload(dep, OUTLAYER, hash, wasm, 'mainnet FastFS');
    if (!(await serves(url, hash))) return check('mainnet FastFS serves the same bytes', false, url);
  }
  check('mainnet FastFS serves the same bytes', true, url);
  saveState({ wasm_url: url, wasm_hash: hash });

  const acc = signer(REGISTRY);
  const source = { WasmUrl: { url, hash, build_target: 'wasm32-wasip2' } };
  const existing = await view<{ active_version: string } | null>(OUTLAYER, 'get_project', {
    project_id: `${REGISTRY}/${PROJECT}`,
  });
  if (existing?.active_version === hash)
    return check(`${REGISTRY}/${PROJECT} already runs ${hash.slice(0, 12)}…`, true);
  const r = existing
    ? await send(
        acc,
        OUTLAYER,
        'add_version',
        { project_name: PROJECT, source, set_active: true },
        PROJECT_DEPOSIT,
        PROJECT_GAS,
      )
    : await send(acc, OUTLAYER, 'create_project', { name: PROJECT, source }, PROJECT_DEPOSIT, PROJECT_GAS);
  check(
    `${existing ? 'added version' : 'created project'} ${REGISTRY}/${PROJECT} at ${hash.slice(0, 12)}…`,
    r.ok,
    r.tx || r.error,
  );
  // Every published version stays callable by its key, so the one replaced goes (and its deposit comes back).
  const old = existing?.active_version;
  if (r.ok && old) {
    const rm = await send(acc, OUTLAYER, 'remove_version', { project_name: PROJECT, version_key: old }, 0n, 30n * TGAS);
    check(`removed the previous version ${old.slice(0, 12)}…`, rm.ok, rm.tx || rm.error);
  }
}

/** Asks the enclave for its sealing key and NEAR account (two runs, $0.002 from the payment key). */
async function pubkey(): Promise<void> {
  const out = await callChecker({ action: 'pubkey' });
  check(
    'the enclave answers with its sealing key and NEAR account',
    /^[0-9a-f]{64}$/.test(out.enc_pk ?? '') && /^[0-9a-f]{64}$/.test(out.account ?? ''),
    `account ${out.account}`,
  );
  const again = await callChecker({ action: 'pubkey' });
  check('and the same keys on the next run', again.enc_pk === out.enc_pk && again.account === out.account);
  if (out.account && out.enc_pk) saveState({ checker_account: out.account, enc_pk: out.enc_pk });
}

/** Funds the enclave's account and makes it the only account the registry takes guards from. */
async function wire(): Promise<void> {
  const s = readState();
  if (!s.checker_account) throw new Error('run `pubkey` first');
  const acc = signer(REGISTRY);
  const enclave = await viewAccount(s.checker_account);
  if (spendable(enclave) < ENCLAVE_FUND / 2n) {
    // From the deploy account, so the registry keeps its float for its own admin calls.
    const t = await sendActions(deployer(), s.checker_account, [actions.transfer(ENCLAVE_FUND)]);
    check(`funded the enclave's account with ${near(ENCLAVE_FUND)} NEAR`, t.ok, t.tx || t.error);
  } else console.log(`the enclave's account holds ${near(spendable(enclave))} NEAR`);
  const cfg = await view<{ checker: string }>(REGISTRY, 'config');
  if (cfg.checker !== s.checker_account) {
    const r = await send(acc, REGISTRY, 'set_checker', { checker: s.checker_account }, 0n, 30n * TGAS);
    check("the registry now takes guards only from the enclave's account", r.ok, r.tx || r.error);
  }
  const after = await view<{ checker: string }>(REGISTRY, 'config');
  check("registry config names the enclave's account", after.checker === s.checker_account, after.checker);
}

/** What is live, read from the chain and compared with the local builds; signs nothing. */
async function status(): Promise<void> {
  const s = readState();
  const code = readWasm(REGISTRY_WASM);
  const reg = await viewAccount(REGISTRY);
  check(
    `${REGISTRY} runs this build`,
    !!reg && !!code && reg.code_hash === baseEncode(sha256(code)),
    reg ? `code hash ${reg.code_hash}, ${near(spendable(reg))} NEAR spendable` : 'not created',
  );
  const cfg = reg ? await view<{ checker: string; outlayer: string; locked: boolean }>(REGISTRY, 'config') : null;
  check('its checker is the enclave', !!cfg && cfg.checker === s.checker_account, JSON.stringify(cfg));
  const project = await view<{ active_version: string } | null>(OUTLAYER, 'get_project', {
    project_id: `${REGISTRY}/${PROJECT}`,
  });
  const checker = mainnetChecker();
  check(
    `${REGISTRY}/${PROJECT} runs this build`,
    !!project && !!checker && project.active_version === sha256(checker).toString('hex'),
    project?.active_version ?? 'no project',
  );
  if (s.checker_account) {
    const enclave = await viewAccount(s.checker_account);
    check("the enclave's account is funded", spendable(enclave) > 0n, `${near(spendable(enclave))} NEAR`);
  }
}

const stage = process.argv[2] ?? 'plan';
const run = { plan, registry, checker: checkerStage, pubkey, wire, status }[stage as 'plan'];
if (!run) {
  console.log('usage: corepack pnpm mainnet:deploy plan | registry | checker | pubkey | wire | status');
  process.exit(2);
}
await run();
if (failed()) process.exit(1);
