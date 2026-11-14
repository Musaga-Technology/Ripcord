// The keeper market on NEAR testnet: a faucet account holding the contract, with the testnet enclave's own account
// named as the only one that can credit a keeper, and a bounty pool.
//   corepack pnpm testnet:keepers account   a fresh faucet account for the market
//   corepack pnpm testnet:keepers deploy    the build script's cargo output, initialised and funded
//   corepack pnpm testnet:keepers status    its settings and leaderboard, read back from chain
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { check, failed, hex, NEAR, random, TGAS } from '../near/lib';

// The build script's cargo step, before wasm-opt shrinks it: testnet storage is free, and NEAR runs both.
const WASM = 'target/near/wasm32-unknown-unknown/release/keeper_market.wasm';
const CREDS = join(homedir(), '.near-credentials', 'testnet');
const STATE = join(homedir(), '.ripcord', 'testnet.json');
/** What a keeper earns per rescue its check fires, and what the pool starts with. */
const BOUNTY = 10n ** 22n; // 0.01 NEAR
const POOL = 1n * NEAR;

interface State {
  keepers?: string;
  checker_account?: string;
}
const readState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const saveState = (s: object) =>
  writeFileSync(STATE, JSON.stringify({ ...readState(), ...s }, null, 1), { mode: 0o600 });
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction<T & object>({ contractId, method, args, finality: 'final' } as never) as Promise<T>;

function market(): Account {
  const id = readState().keepers;
  if (!id) throw new Error('no keeper market account yet: run `account` first');
  const creds = JSON.parse(readFileSync(join(CREDS, `${id}.json`), 'utf8')) as { private_key: string };
  return new Account(id, provider, creds.private_key as KeyPairString);
}

async function account(): Promise<void> {
  if (readState().keepers) return console.log(`keeper market account exists: ${readState().keepers}`);
  const kp = KeyPair.fromRandom('ed25519');
  const id = `ripcord-keepers-${hex(random(4))}.testnet`;
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
  if (res.ok) saveState({ keepers: id });
}

async function deploy(): Promise<void> {
  const enclave = readState().checker_account;
  if (!enclave)
    throw new Error("no testnet enclave account in ~/.ripcord/testnet.json: run the testnet checker's pubkey stage");
  const acc = market();
  const code = new Uint8Array(readFileSync(WASM));
  const r = (await acc.deployContract(code)) as unknown as { transaction_outcome?: { id: string } };
  check(
    `deployed ${code.length.toLocaleString()} bytes to ${acc.accountId}`,
    !!r.transaction_outcome,
    r.transaction_outcome?.id,
  );
  try {
    await view(acc.accountId, 'get_config');
    console.log('already initialised');
  } catch {
    await acc.callFunction({
      contractId: acc.accountId,
      methodName: 'new',
      args: { checker: enclave, owner: acc.accountId, bounty: BOUNTY.toString() },
      gas: 30n * TGAS,
    } as never);
    check('initialised: only the testnet enclave can credit keepers', true, enclave);
    await acc.callFunction({
      contractId: acc.accountId,
      methodName: 'fund',
      args: {},
      deposit: POOL,
      gas: 10n * TGAS,
    } as never);
    check('funded the bounty pool', true, '1 NEAR');
  }
  await status();
}

async function status(): Promise<void> {
  const id = market().accountId;
  const config = await view<Record<string, unknown>>(id, 'get_config');
  console.log(`https://testnet.nearblocks.io/address/${id}`);
  console.log('config:', JSON.stringify(config));
  console.log('leaderboard:', JSON.stringify(await view(id, 'leaderboard', { from: 0, limit: 10 })));
}

const stage = process.argv[2] ?? 'status';
const run = { account, deploy, status }[stage as 'status'];
if (!run) throw new Error('usage: corepack pnpm testnet:keepers account | deploy | status');
await run();
if (failed()) process.exit(1);
