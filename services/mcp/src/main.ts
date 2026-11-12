// Ripcord's tools over stdio, for any MCP client: `pnpm --filter @ripcord/mcp start`. Mainnet by default.
//   RIPCORD_APP_URL     where guards are set up; its /api/checker relay reaches the checker
//   RIPCORD_POKERS      the pokers that watch a funded guard, comma-separated
//   RIPCORD_PASSPHRASE  locks the seal files this server writes (the model never sees it)
//   RIPCORD_HOME        where seal files live, ~/.ripcord by default
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { sources } from './read';
import { ripcordServer } from './tools';

const env = process.env;
const appUrl = env.RIPCORD_APP_URL?.replace(/\/$/, '') || null;
const src = sources(env);
const server = ripcordServer({
  sources: src,
  appUrl,
  owner: {
    sources: src,
    relay: appUrl && `${appUrl}/api/checker`,
    pokers: (env.RIPCORD_POKERS ?? '')
      .split(',')
      .map((p) => p.trim().replace(/\/$/, ''))
      .filter(Boolean),
    home: env.RIPCORD_HOME || join(homedir(), '.ripcord'),
    passphrase: env.RIPCORD_PASSPHRASE || null,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: Date.now,
  },
});
await server.connect(new StdioServerTransport());
