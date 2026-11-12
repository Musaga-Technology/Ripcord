// Runs the risk desk: `MARKET_TOKEN=aat_… pnpm --filter @ripcord/mcp desk`, polling every 30 s as the market
// asks (`--once` for a single pass). RIPCORD_APP_URL names where guards are set up.
import { sources } from './read';
import { work } from './desk';

const token = process.env.MARKET_TOKEN;
if (!token?.startsWith('aat_')) {
  console.error('Set MARKET_TOKEN to the desk agent token (aat_…).');
  process.exit(1);
}
const deps = {
  market: process.env.MARKET_API || 'https://market.near.ai',
  token,
  sources: sources(),
  appUrl: process.env.RIPCORD_APP_URL?.replace(/\/$/, '') || null,
  fetch,
  log: (line: string) => console.log(`${new Date().toISOString()} ${line}`),
  now: () => new Date(),
};

for (;;) {
  try {
    await work(deps);
  } catch (e) {
    deps.log(`poll failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
  if (process.argv.includes('--once')) break;
  await new Promise((r) => setTimeout(r, 30_000));
}
