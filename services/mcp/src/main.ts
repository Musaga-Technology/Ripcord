// Ripcord's tools over stdio, for any MCP client: `pnpm --filter @ripcord/mcp start`. Mainnet by default;
// RIPCORD_APP_URL names where guards are set up.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { sources } from './read';
import { ripcordServer } from './tools';

const server = ripcordServer({ sources: sources(), appUrl: process.env.RIPCORD_APP_URL?.replace(/\/$/, '') || null });
await server.connect(new StdioServerTransport());
