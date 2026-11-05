// The guard flow's logic: what the example enclave demands, what the server route refuses, and the numbers on screen.
import { createInput, prepareGuard } from '@ripcord/shared';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/checker/route';
import { ASSETS, suggestAmount } from '../lib/assets';
import { demo, random, Refused } from '../lib/backend';
import { guardOf, watchedDistance, type ShownGuard } from '../lib/guards';
import { parseAccount, type Holding } from '../lib/hl';
import { markedPreset, replayFigure } from '../lib/replay';
import { approveAgentAction, approveAgentTypedData } from '../lib/wallet';

const HL = '0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3';
const draft = {
  hl_address: HL,
  preset: 'balanced' as const,
  distance: 17.3,
  budget_usd: 4200,
  reserve_asset: 'nep141:btc.omft.near',
  isolated: null,
  days: 90,
};

describe('the example enclave does what the checker does', () => {
  it('opens the envelope and checks the hashes', async () => {
    const b = demo();
    const p = prepareGuard(draft, random, Date.now());
    const input = createInput(p, await b.pubkey(), random);
    expect(await b.create(input, p.contents.receipt_secret)).toEqual({ agent: null });
    await expect(b.create({ ...input, commitment: 'ab'.repeat(32) }, p.contents.receipt_secret)).rejects.toThrow(
      Refused,
    );
  });

  it('names an agent only for an isolated guard, and only to its owner', async () => {
    const b = demo();
    const p = prepareGuard({ ...draft, isolated: 'HYPE' }, random, Date.now());
    const { agent } = await b.create(createInput(p, await b.pubkey(), random), p.contents.receipt_secret);
    expect(agent).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('the server route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const ask = (body: object, ip = '10.0.0.1') =>
    POST(
      new NextRequest('http://x/api/checker', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'x-forwarded-for': ip },
      }),
    );

  it('carries only what a browser may ask, and keeps the payment key on the server', async () => {
    vi.stubEnv('OUTLAYER_API_BASE', 'https://outlayer.test');
    vi.stubEnv('CHECKER_PROJECT', 'ops/checker');
    vi.stubEnv('OUTLAYER_PAYMENT_KEY', 'secret-key');
    const upstream = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ status: 'completed', output: { enc_pk: 'ab' } })),
    );
    vi.stubGlobal('fetch', upstream);

    expect((await ask({ action: 'check', guard_id: 'g-aaaaaaaaaa' })).status).toBe(403);
    expect((await ask({ action: 'anything' })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();

    const r = await ask({ action: 'pubkey' });
    expect(await r.json()).toEqual({ enc_pk: 'ab' });
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe('https://outlayer.test/call/ops/checker');
    expect((init?.headers as Record<string, string>)['X-Payment-Key']).toBe('secret-key');
  });

  it('says so when it is not configured, and limits a noisy caller', async () => {
    expect((await ask({ action: 'pubkey' })).status).toBe(503);
    vi.stubEnv('OUTLAYER_API_BASE', 'https://outlayer.test');
    vi.stubEnv('CHECKER_PROJECT', 'ops/checker');
    vi.stubEnv('OUTLAYER_PAYMENT_KEY', 'k');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ status: 'completed', output: {} })));
    const codes = [];
    for (let i = 0; i < 32; i++) codes.push((await ask({ action: 'pubkey' }, '10.0.0.9')).status);
    expect(codes.at(-1)).toBe(429);
  });
});

function holding(over: Partial<Holding>): Holding {
  return {
    coin: 'ETH',
    szi: 1,
    size: 1,
    side: 'Long',
    mark: 100,
    entry: 100,
    liquidation: 80,
    distance: 20,
    leverage: 10,
    margin: 'cross',
    marginUsed: 10,
    maxLeverage: 25,
    notional: 100,
    ...over,
  };
}

const shown = (over: Partial<ShownGuard>): ShownGuard => ({
  id: 'g-aaaaaaaaaa',
  commitment: 'ab',
  fingerprint: 'AB',
  coin: 'ETH',
  label: 'x',
  margin: 'cross',
  example: null,
  local: null,
  state: 'guarded',
  ...over,
});

describe('what a guard covers', () => {
  it('a cross guard covers every cross position, an isolated guard only its own', () => {
    const cross = shown({});
    const iso = shown({ coin: 'HYPE', margin: 'isolated' });
    expect(guardOf(holding({ coin: 'BTC' }), [cross])).toBe(cross);
    expect(guardOf(holding({ coin: 'SOL', margin: 'isolated' }), [cross, iso])).toBeNull();
    expect(guardOf(holding({ coin: 'HYPE', margin: 'isolated' }), [cross, iso])).toBe(iso);
  });

  it('a cross guard draws its line from the nearest cross position, as the checker measures', () => {
    const all = [
      holding({ distance: 20 }),
      holding({ coin: 'BTC', distance: 12 }),
      holding({ margin: 'isolated', distance: 5 }),
    ];
    expect(watchedDistance(all[0]!, all)).toBe(12);
    expect(watchedDistance(all[2]!, all)).toBe(5);
  });
});

describe('numbers on screen', () => {
  it('reads an account as Hyperliquid sends it', () => {
    const a = parseAccount({
      marginSummary: { accountValue: '2000.5' },
      assetPositions: [
        {
          position: {
            coin: 'BTC',
            szi: '-0.1',
            entryPx: '80000',
            positionValue: '8000',
            liquidationPx: null,
            marginUsed: '800',
            maxLeverage: 40,
            leverage: { type: 'isolated', value: 10 },
          },
        },
      ],
    });
    expect(a.value).toBe(2000.5);
    expect(a.holdings[0]).toMatchObject({ side: 'Short', mark: 80000, distance: null, margin: 'isolated' });
  });

  it('a suggested 2× reserve is at least 2×, so it reads from the 2× replay band', () => {
    const eth = ASSETS.find((a) => a.symbol === 'ETH')!;
    const amount = Number(suggestAmount(eth, 5991.11, 2430));
    expect(amount * 2430).toBeGreaterThanOrEqual(5991.11);
  });

  it('takes the band at or below the reserve, and has no figure under the lowest', () => {
    expect(replayFigure('ETH', 10, 1.9, 'balanced')?.band).toBe(1);
    expect(replayFigure('ETH', 10, 2, 'balanced')?.band).toBe(2);
    expect(replayFigure('ETH', 10, 0.4, 'balanced')).toBeNull();
    expect(replayFigure('DOGE', 7, 1, 'lean')?.source).toContain('ETH 10×');
  });

  it('marks Lean only from 1.5× margin', () => {
    expect(markedPreset(1.49)).toBe('balanced');
    expect(markedPreset(1.5)).toBe('lean');
  });
});

describe("the wallet's one signature", () => {
  it('is a Hyperliquid approveAgent, with the expiry in the name', () => {
    const a = approveAgentAction('0xdead', 'ab12cd34', 1_800_000_000_000, '0xa4b1', 42);
    expect(a.agentName).toBe('ab12cd34 valid_until 1800000000000');
    const t = approveAgentTypedData(a);
    expect(t.domain.chainId).toBe(42161);
    expect(t.primaryType).toBe('HyperliquidTransaction:ApproveAgent');
    expect(Object.keys(t.message)).toEqual(['hyperliquidChain', 'agentAddress', 'agentName', 'nonce']);
  });
});
