import { describe, expect, it } from 'vitest';
import { forScreen, runAgent, type Call, type Model } from '../src/agent';

const ACCOUNT = `0x${'15'.repeat(20)}`;
const WALLET = `0x${'5e'.repeat(20)}` as const;
const DEPOSIT = `0x${'a1'.repeat(20)}` as const;
const QUOTE = {
  address: DEPOSIT,
  units: '1016234875775971',
  amount: '0.001016234875775971',
  token: 'ETH',
  chain: 'base',
  assetId: 'nep141:base.omft.near',
};

let n = 0;
const call = (name: string, args: Record<string, unknown> = {}): Call => ({
  id: `c${++n}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

/** A model that follows a script, one step per answer, and records what it was shown. */
function scripted(steps: { content?: string; calls?: Call[] }[]) {
  const seen: Parameters<Model>[] = [];
  const model: Model = async (messages, tools) => {
    seen.push([structuredClone(messages), tools]);
    const s = steps.shift() ?? { content: 'Done.' };
    return { content: s.content ?? null, ...(s.calls ? { tool_calls: s.calls } : {}) };
  };
  return { model, seen };
}

/** Ripcord's tools, answering as the server does; finish_guard says "Not yet" once. */
function tools() {
  const calls: { name: string; arguments: unknown }[] = [];
  let finishes = 0;
  return {
    calls,
    client: {
      listTools: async () => ({
        tools: ['liquidation_risk', 'replay_odds', 'create_guard', 'fund_guard', 'finish_guard', 'freeze_guard'].map(
          (name) => ({ name, description: name, inputSchema: { type: 'object' as const } }),
        ),
      }),
      callTool: async (p: { name: string; arguments?: Record<string, unknown> }) => {
        calls.push({ name: p.name, arguments: p.arguments });
        const text = (t: string) => ({ content: [{ type: 'text', text: t }] });
        if (p.name === 'fund_guard')
          return { ...text(`Send exactly ${QUOTE.amount} ETH on base to ${DEPOSIT}.`), structuredContent: QUOTE };
        if (p.name === 'finish_guard')
          return text(++finishes === 1 ? "Not yet: the reserve hasn't landed." : 'Guarding: the reserve landed.');
        if (p.name === 'create_guard') return text('Sealed guard g-k3vrq2m7xa for the ETH long (cross margin).');
        return text('# Liquidation risk\n**Nearest: ETH long, 6.2% from liquidation.**');
      },
    } as never,
  };
}

function wallet() {
  const paid: { to: string; wei: bigint }[] = [];
  return {
    paid,
    wallet: {
      address: WALLET,
      pay: async (to: `0x${string}`, wei: bigint) => (paid.push({ to, wei }), `0x${'cd'.repeat(32)}`),
    },
  };
}

describe('the demo agent', () => {
  it('checks its risk, guards itself, pays the exact quote from its own wallet and stops once guarding', async () => {
    const { model, seen } = scripted([
      { content: 'Checking my risk.', calls: [call('liquidation_risk', { address: ACCOUNT })] },
      {
        content: 'Guarding my ETH long.',
        calls: [call('create_guard', { address: ACCOUNT, coin: 'ETH', reserve_usd: 2 })],
      },
      {
        calls: [
          call('fund_guard', { guard_id: 'g-k3vrq2m7xa', from: 'any', token: 'ETH', chain: 'base', refund_to: WALLET }),
        ],
      },
      // The model tries to name its own recipient and amount: ignored.
      { content: 'Paying the deposit.', calls: [call('pay_deposit', { to: `0x${'66'.repeat(20)}`, amount: '5' })] },
      { calls: [call('finish_guard', { guard_id: 'g-k3vrq2m7xa' })] },
      { calls: [call('finish_guard', { guard_id: 'g-k3vrq2m7xa' })] },
      { content: 'Guarded: my reserve is in place and nobody can see it.' },
    ]);
    const t = tools();
    const w = wallet();
    const lines: string[] = [];
    const waits: number[] = [];
    const end = await runAgent({
      client: t.client,
      model,
      wallet: w.wallet,
      account: ACCOUNT,
      reserveUsd: 2,
      say: (l) => lines.push(l),
      wait: async (ms) => void waits.push(ms),
    });

    expect(end).toBe('guarding');
    expect(w.paid).toEqual([{ to: DEPOSIT, wei: 1016234875775971n }]);
    expect(t.calls.map((c) => c.name)).toEqual([
      'liquidation_risk',
      'create_guard',
      'fund_guard',
      'finish_guard',
      'finish_guard',
    ]);
    expect(waits).toEqual([20_000]);
    // Offered only the tools it needs, plus its wallet's one payment.
    expect(seen[0]![1].map((t) => t.function.name)).toEqual([
      'liquidation_risk',
      'create_guard',
      'fund_guard',
      'finish_guard',
      'pay_deposit',
    ]);
    // Filmed: no full address or hash on screen.
    expect(lines.join('\n')).not.toMatch(/0x[0-9a-f]{40}/i);
    expect(lines).toContain('→ pay_deposit({"to":"0x6666…6666","amount":"5"})');
    expect(lines.at(-1)).toBe('agent › Guarded: my reserve is in place and nobody can see it.');
  });

  it('pays nothing before a quote, and only in ETH on Base', async () => {
    const { model } = scripted([{ calls: [call('pay_deposit')] }, { content: 'Stopping.' }]);
    const w = wallet();
    const lines: string[] = [];
    const end = await runAgent({
      client: tools().client,
      model,
      wallet: w.wallet,
      account: ACCOUNT,
      reserveUsd: 2,
      say: (l) => lines.push(l),
      wait: async () => {},
    });
    expect(end).toBe('stopped');
    expect(w.paid).toEqual([]);
    expect(lines).toContain('  Nothing to pay yet: call fund_guard with from "any" first.');
  });

  it('shortens addresses and hashes for the screen', () => {
    expect(forScreen(`to ${DEPOSIT} in ${'0x' + 'cd'.repeat(32)}`)).toBe('to 0xa1a1…a1a1 in 0xcdcd…cdcd');
  });
});
