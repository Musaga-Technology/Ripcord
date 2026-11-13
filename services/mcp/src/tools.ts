// Ripcord's MCP server. Read: a Hyperliquid account's liquidation risk, what the crash replays say about guarding it,
// and what any guard on NEAR is doing. Own: an agent seals, funds and can freeze a guard for its own account, with the
// seal file kept on its machine; no tool moves money, and none returns a guard's settings.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readAccount, shortAddress, view, type Sources } from './read';
import type { Preset } from '@ripcord/shared';
import {
  createGuard,
  finishGuard,
  freezeGuard,
  fundGuard,
  fundGuardWithAnyToken,
  type FundFrom,
  type OwnerDeps,
} from './owner';
import { assess, replayOdds, riskMarkdown } from './risk';

export interface ToolDeps {
  sources: Sources;
  /** Where people set up a guard, without a trailing slash; null until the app is hosted. */
  appUrl: string | null;
  now?: () => Date;
  /** The owner side: where seal files live and how the checker is reached. */
  owner?: OwnerDeps;
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

  const owned =
    <A>(run: (o: OwnerDeps, args: A) => Promise<string | { text: string; data: Record<string, unknown> }>) =>
    async (args: A) => {
      try {
        if (!d.owner) throw new Error('This server was started without an owner side.');
        const r = await run(d.owner, args);
        return typeof r === 'string' ? text(r) : { ...text(r.text), structuredContent: r.data };
      } catch (e) {
        return failed(e);
      }
    };
  const OWNER = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

  server.registerTool(
    'create_guard',
    {
      title: 'Create a guard',
      description:
        "Seal a Ripcord guard for a position on the agent's own Hyperliquid account: a hidden USDC reserve that lands in its margin before the liquidator gets there, at a line nobody can see, the agent included. The settings are sealed on this machine for the enclave on NEAR; the seal file stays here. A cross guard covers every cross position. Next: fund_guard.",
      inputSchema: {
        address: z.string().describe('The Hyperliquid account the agent trades from, 0x…'),
        coin: z.string().describe('The position to guard, e.g. ETH; for cross margin, any cross position'),
        reserve_usd: z
          .number()
          .min(2)
          .optional()
          .describe("The reserve in USD, $2 or more; by default the position's margin"),
        preset: z
          .enum(['safer', 'balanced', 'lean'])
          .optional()
          .describe('When to step in; by default the one the replays liquidated least at this reserve'),
        days: z.number().int().min(1).max(365).optional().describe('How long the guard runs; 90 by default'),
      },
      annotations: OWNER,
    },
    owned(
      async (
        o,
        a: {
          address: string;
          coin: string;
          reserve_usd?: number | undefined;
          preset?: Preset | undefined;
          days?: number | undefined;
        },
      ) => {
        const g = await createGuard(o, {
          address: a.address,
          coin: a.coin,
          reserveUsd: a.reserve_usd,
          preset: a.preset,
          days: a.days,
        });
        return [
          `Sealed guard ${g.guardId} for the ${g.position} (${g.margin} margin). Fingerprint ${g.fingerprint}.`,
          `Its settings are in the seal file ${g.file}, locked with this server's passphrase; only three hashes and a sealed envelope left this machine.`,
          g.approval
            ? `Next: approve the agent key ${g.approval.agent} on Hyperliquid, named "${g.approval.name}", with the account's own signer (approveAgent). It can add margin to this position and can't withdraw or send. Then fund_guard.`
            : 'Next: fund_guard.',
        ].join('\n');
      },
    ),
  );

  server.registerTool(
    'fund_guard',
    {
      title: 'Fund a guard',
      description:
        "Where to send a guard's reserve, and exactly how much. USDC from Arbitrum (size stays private) or Hyperliquid (the send is public), or 'any': pay in whatever token the agent holds on whatever chain, through Aurora's Intents API on NEAR Intents, routed confidentially so the paying wallet can't be traced to the guard, which still receives the exact reserve. Then finish_guard.",
      inputSchema: {
        guard_id: z.string().describe('The id create_guard gave'),
        from: z.enum(['arbitrum', 'hyperliquid', 'any']).describe('Where the reserve comes from'),
        token: z.string().optional().describe("With 'any': the token to pay in, e.g. ETH, USDC, USDT, SOL"),
        chain: z
          .string()
          .optional()
          .describe("With 'any': its chain as NEAR Intents names it, e.g. eth, base, arb, op, pol, bsc, sol, near"),
        refund_to: z
          .string()
          .optional()
          .describe("With 'any': the agent's own address on that chain, where it goes back if the swap can't fill"),
      },
      annotations: OWNER,
    },
    owned(
      async (
        o,
        a: {
          guard_id: string;
          from: FundFrom | 'any';
          token?: string | undefined;
          chain?: string | undefined;
          refund_to?: string | undefined;
        },
      ) => {
        if (a.from === 'any') {
          if (!a.token || !a.chain || !a.refund_to)
            throw new Error("Paying in any token needs token, chain and refund_to (the agent's own address there).");
          const f = await fundGuardWithAnyToken(o, {
            guardId: a.guard_id,
            token: a.token,
            chain: a.chain,
            refundTo: a.refund_to,
          });
          return {
            text: [
              `Send exactly ${f.amount} ${f.token} on ${f.chain} to ${f.address}${f.deadline ? ` before ${f.deadline}` : ''}.`,
              `Aurora routes it confidentially through NEAR Intents, and the guard's deposit address receives exactly ${f.reserve} USDC. If it can't fill, it goes back to ${a.refund_to}.`,
              'Then call finish_guard: it usually arrives in about a minute.',
            ].join('\n'),
            // The quote as data, so a wallet pays these exact figures rather than text a model wrote.
            data: { ...f },
          };
        }
        return fundOne(o, a.guard_id, a.from);
      },
    ),
  );

  async function fundOne(o: OwnerDeps, guardId: string, from: FundFrom): Promise<string> {
    const f = await fundGuard(o, { guardId, from });
    return [
      `Send exactly ${f.amount} USDC on ${f.chain} to ${f.address}.`,
      `${f.how} ${f.note}`,
      'Then call finish_guard: it usually arrives in about a minute.',
    ].join('\n');
  }

  server.registerTool(
    'finish_guard',
    {
      title: 'Finish a guard',
      description:
        "Checks whether a guard's reserve has landed. Once it has, the guard goes on NEAR and the pokers start watching its account. Safe to call again.",
      inputSchema: { guard_id: z.string().describe('The id create_guard gave') },
      annotations: { ...OWNER, idempotentHint: true },
    },
    owned(async (o, a: { guard_id: string }) => {
      const r = await finishGuard(o, { guardId: a.guard_id });
      if (r.state === 'waiting') return "Not yet: the reserve hasn't landed. Try again in a minute.";
      return `Guarding: the reserve landed and guard ${a.guard_id} is on NEAR. ${
        r.watchers
          ? `${r.watchers} poker${r.watchers === 1 ? '' : 's'} watch it.`
          : 'No poker took it: set RIPCORD_POKERS.'
      }`;
    }),
  );

  server.registerTool(
    'freeze_guard',
    {
      title: 'Freeze or unfreeze a guard',
      description:
        "The owner's brake: while a guard is frozen nothing leaves its reserve, rescues included. Signed on this machine with the seal file's owner key and checked by the registry on NEAR.",
      inputSchema: {
        guard_id: z.string().describe('The id create_guard gave'),
        frozen: z.boolean().describe('true to freeze, false to unfreeze'),
      },
      annotations: { ...OWNER, idempotentHint: true },
    },
    owned(async (o, a: { guard_id: string; frozen: boolean }) => {
      await freezeGuard(o, { guardId: a.guard_id, frozen: a.frozen });
      return a.frozen
        ? `Frozen: nothing leaves guard ${a.guard_id}'s reserve until it is unfrozen.`
        : `Unfrozen: guard ${a.guard_id} is guarding again.`;
    }),
  );

  return server;
}
