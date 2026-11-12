// Ripcord's MCP server: tools any agent can call to see a Hyperliquid account's liquidation risk, what the crash
// replays say about guarding it, and what any guard on NEAR is doing. Read-only: no tool signs, moves money or
// learns a guard's settings.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readAccount, shortAddress, view, type Sources } from './read';
import { assess, replayOdds, riskMarkdown } from './risk';

export interface ToolDeps {
  sources: Sources;
  /** Where people set up a guard, without a trailing slash; null until the app is hosted. */
  appUrl: string | null;
  now?: () => Date;
}

interface Guard {
  guard_id: string;
  status: string;
  created_at: string;
  expires_at: string;
  receipt_count: number;
  arm_count: number;
}
interface Receipt {
  public: { at_hour: number; credit_usd: number; latency_s: number; outcome: string };
}
interface Stats {
  guards: number;
  rescues: number;
  saves: number;
  margin_added_usd: number;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const failed = (e: unknown) => ({ ...text(e instanceof Error ? e.message : 'Something went wrong.'), isError: true });
const day = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().slice(0, 10);
const hour = (s: number) => `${new Date(s * 1000).toISOString().slice(0, 13).replace('T', ' ')}:00 UTC`;
const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function ripcordServer(d: ToolDeps): McpServer {
  const now = d.now ?? (() => new Date());
  const server = new McpServer({ name: 'ripcord', version: '0.1.0' });

  server.registerTool(
    'liquidation_risk',
    {
      title: 'Liquidation risk',
      description:
        "A Hyperliquid account's open positions, nearest to liquidation first: liquidation price, distance, and what the crash replays say about guarding the nearest one. Public data only.",
      inputSchema: { address: z.string().describe('The Hyperliquid account, 0x followed by 40 hex characters') },
      annotations: READ_ONLY,
    },
    async ({ address }) => {
      try {
        const risk = assess(await readAccount(d.sources, address), now());
        return {
          ...text(riskMarkdown(risk, { account: shortAddress(address), appUrl: d.appUrl })),
          structuredContent: risk as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    'replay_odds',
    {
      title: 'Replay odds',
      description:
        'How often positions like this were liquidated in replays of real prices (Oct 2025 to Jun 2026), with no guard, with a Ripcord guard, and with the reserve posted upfront.',
      inputSchema: {
        coin: z.string().describe('BTC, ETH, SOL or HYPE; other coins use ETH'),
        leverage: z.number().positive().describe('The position leverage, e.g. 10'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ coin, leverage }) => {
      const x = replayOdds(coin, leverage);
      return {
        ...text(
          `${x.source}: ${x.unguarded}% liquidated with no guard; ${x.guarded1x}% with a Ripcord guard and a reserve the size of the margin, ${x.guarded2x}% at twice it; ${x.upfront1x}% with that reserve posted upfront.`,
        ),
        structuredContent: x as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'guard_status',
    {
      title: 'Guard status',
      description:
        "A Ripcord guard's public record on NEAR: its status, when it was made, and its recent rescues (hour and rounded amount only; nothing links a guard to its account).",
      inputSchema: { guard_id: z.string().describe("The guard's id, as its owner's app shows it") },
      annotations: READ_ONLY,
    },
    async ({ guard_id }) => {
      try {
        const g = await view<Guard | null>(d.sources, 'get_guard', { guard_id });
        if (!g) return text(`No guard ${guard_id} on ${d.sources.registry}.`);
        const from = Math.max(0, g.receipt_count - 5);
        const receipts = await view<Receipt[]>(d.sources, 'get_receipts', { guard_id, from, limit: 5 });
        const lines = [
          `Guard ${g.guard_id} on ${d.sources.registry}: ${g.status.toLowerCase()}, made ${day(g.created_at)}, runs to ${day(g.expires_at)}.`,
          `${g.receipt_count} rescue${g.receipt_count === 1 ? '' : 's'}, ${g.arm_count} line${g.arm_count === 1 ? '' : 's'} drawn.`,
          ...receipts.map(
            (r) =>
              `- ${hour(r.public.at_hour)}: about $${r.public.credit_usd} landed in ${r.public.latency_s} s, ${r.public.outcome}.`,
          ),
        ];
        return text(lines.join('\n'));
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    'ripcord_ledger',
    {
      title: 'Ripcord ledger',
      description: 'Every guard and rescue Ripcord has made, counted by its registry contract on NEAR.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const s = await view<Stats>(d.sources, 'stats', {});
        return {
          ...text(
            `${d.sources.registry}: ${s.guards} guards, ${s.rescues} rescues, ${s.saves} saves, $${s.margin_added_usd.toFixed(2)} of margin added.`,
          ),
          structuredContent: s as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return failed(e);
      }
    },
  );

  return server;
}
