// A demo trading agent that guards its own Hyperliquid position. A model decides each step; Ripcord's MCP tools do the
// work; the agent's own wallet pays the one thing that costs money, the deposit. The model can't choose where money
// goes: `pay_deposit` takes no arguments and pays exactly the quote `fund_guard` returned, as data.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { AgentWallet } from './wallet';

export interface Call {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Call[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}
/** One step of the model: something to say, tools to call, or both. */
export type Model = (messages: Msg[], tools: ToolDef[]) => Promise<{ content: string | null; tool_calls?: Call[] }>;

const RIPCORD_TOOLS = ['liquidation_risk', 'create_guard', 'fund_guard', 'finish_guard'];

const PAY: ToolDef = {
  type: 'function',
  function: {
    name: 'pay_deposit',
    description:
      "Pays the deposit fund_guard quoted, from this agent's own wallet on Base: exactly that amount to exactly that address. Takes no arguments.",
    parameters: { type: 'object', properties: {} },
  },
};

/** Addresses and hashes, shortened for the screen: the session is filmed. */
export const forScreen = (s: string) => s.replace(/0x[0-9a-fA-F]{36,}/g, (h) => `${h.slice(0, 6)}…${h.slice(-4)}`);

interface Quote {
  address: `0x${string}`;
  units: string;
  amount: string;
  token: string;
  chain: string;
  assetId: string;
}

export async function runAgent(o: {
  client: Pick<Client, 'listTools' | 'callTool'>;
  model: Model;
  wallet: Pick<AgentWallet, 'address' | 'pay'>;
  /** The Hyperliquid account it trades. */
  account: string;
  reserveUsd: number;
  say(line: string): void;
  wait(ms: number): Promise<void>;
  maxSteps?: number;
}): Promise<'guarding' | 'stopped'> {
  const listed = (await o.client.listTools()).tools.filter((t) => RIPCORD_TOOLS.includes(t.name));
  const tools: ToolDef[] = [
    ...listed.map((t): ToolDef => ({
      type: 'function',
      function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
    })),
    PAY,
  ];
  const messages: Msg[] = [
    {
      role: 'system',
      content: [
        'You are a trading agent on Hyperliquid. Liquidation hunters can see your liquidation price, so you protect your positions with Ripcord.',
        `Plan: check your risk with liquidation_risk. Guard your nearest position with create_guard (reserve_usd ${o.reserveUsd}).`,
        `Fund it with fund_guard from "any", paying ETH on base with refund_to ${o.wallet.address}, then call pay_deposit, then finish_guard until it says Guarding.`,
        'Speak as yourself about your own account ("my BTC long"). Before each step, say what you are doing in one short sentence. When the guard is guarding, say so in one sentence and stop.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Your Hyperliquid account is ${o.account}. Your wallet holds ETH on Base at ${o.wallet.address}. Protect your positions.`,
    },
  ];
  let quote: Quote | null = null;
  let guarding = false;

  for (let step = 0; step < (o.maxSteps ?? 20); step++) {
    const r = await o.model(messages, tools);
    if (r.content?.trim()) o.say(`agent › ${forScreen(r.content.trim())}`);
    messages.push({
      role: 'assistant',
      content: r.content,
      ...(r.tool_calls?.length ? { tool_calls: r.tool_calls } : {}),
    });
    if (!r.tool_calls?.length) return guarding ? 'guarding' : 'stopped';

    for (const call of r.tool_calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        // Unreadable arguments: the tool answers with its own error.
      }
      o.say(`→ ${name}(${forScreen(JSON.stringify(args))})`);
      let answer: string;
      if (name === 'pay_deposit') {
        if (!quote) answer = 'Nothing to pay yet: call fund_guard with from "any" first.';
        else if (quote.assetId !== 'nep141:base.omft.near') answer = 'This wallet pays only in ETH on Base.';
        else {
          const hash = await o.wallet.pay(quote.address, BigInt(quote.units));
          answer = `Paid ${quote.amount} ETH on base to ${quote.address} in transaction ${hash}.`;
        }
      } else if (RIPCORD_TOOLS.includes(name)) {
        const res = await o.client.callTool({ name, arguments: args });
        answer = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
        if (name === 'fund_guard' && !res.isError && res.structuredContent)
          quote = res.structuredContent as unknown as Quote;
        if (name === 'finish_guard' && answer.startsWith('Guarding')) guarding = true;
      } else answer = `There is no tool called ${name}.`;
      o.say(
        forScreen(
          answer
            .split('\n')
            .slice(0, name === 'liquidation_risk' ? 0 : 2)
            .map((l) => `  ${l}`)
            .join('\n') || '  (report read)',
        ),
      );
      messages.push({ role: 'tool', tool_call_id: call.id, content: answer });
      if (name === 'finish_guard' && answer.startsWith('Not yet')) await o.wait(20_000);
    }
  }
  return guarding ? 'guarding' : 'stopped';
}

/** NEAR AI Cloud's OpenAI-compatible chat API: the model runs in a TEE. */
export function nearAi(apiKey: string, model = 'Qwen/Qwen3.8-27B', fetchFn: typeof fetch = fetch): Model {
  return async (messages, tools) => {
    const res = await fetchFn('https://cloud-api.near.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`NEAR AI answered ${res.status}.`);
    const r = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: Call[] } }[] };
    const m = r.choices[0]!.message;
    return { content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) };
  };
}
