// The demo agent: `pnpm --filter @ripcord/mcp agent`. It thinks with NEAR AI Cloud, uses Ripcord's tools over MCP,
// and pays from its own wallet on Base. `--wallet` prints that wallet's address and balance, to fund it, and stops.
//   AGENT_ACCOUNT   the Hyperliquid account it trades
//   NEARAI_API_KEY  for the model; the owner side's settings are in config.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { formatEther } from 'viem';
import { runAgent, nearAi } from './agent';
import { appUrlFrom, ownerFromEnv } from './config';
import { isAddress, sources } from './read';
import { ripcordServer } from './tools';
import { agentWallet } from './wallet';

const env = process.env;
const owner = ownerFromEnv(sources(env));
const wallet = await agentWallet(owner.home);

if (process.argv.includes('--wallet')) {
  console.log(`agent wallet on Base: ${wallet.address}, holding ${formatEther(await wallet.balance())} ETH`);
  process.exit(0);
}

const account = env.AGENT_ACCOUNT ?? '';
if (!isAddress(account) || !env.NEARAI_API_KEY) {
  console.error('Set AGENT_ACCOUNT (the Hyperliquid account) and NEARAI_API_KEY.');
  process.exit(1);
}

const server = ripcordServer({ sources: owner.sources, appUrl: appUrlFrom(env), owner });
const client = new Client({ name: 'ripcord-demo-agent', version: '0.1.0' });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);

console.log('Trading agent · thinks with NEAR AI Cloud · guards itself with Ripcord · pays from its own wallet\n');
const end = await runAgent({
  client,
  model: nearAi(env.NEARAI_API_KEY, env.NEARAI_MODEL || undefined),
  wallet,
  account,
  reserveUsd: Number(env.AGENT_RESERVE_USD ?? '2'),
  say: (line) => console.log(line),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
});
process.exit(end === 'guarding' ? 0 : 1);
