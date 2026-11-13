// Ripcord's tools over stdio, for any MCP client: `pnpm --filter @ripcord/mcp start`. Mainnet by default; the owner
// side's settings are in config.ts.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { appUrlFrom, ownerFromEnv } from './config';
import { sources } from './read';
import { ripcordServer } from './tools';

const src = sources(process.env);
const server = ripcordServer({ sources: src, appUrl: appUrlFrom(), owner: ownerFromEnv(src) });
await server.connect(new StdioServerTransport());
