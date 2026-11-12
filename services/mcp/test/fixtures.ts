import type { RawPosition } from '@ripcord/shared';

// A public Hyperliquid account and a stub of every endpoint the tools read, so tests never touch the network.
export const ADDRESS = '0x15a6c0ffee00000000000000000000000c0d9fe3';

export const STATE = {
  marginSummary: { accountValue: '28410.55' },
  assetPositions: [
    {
      position: {
        coin: 'SOL',
        szi: '140',
        entryPx: '100',
        positionValue: '14978.6',
        liquidationPx: '87.1',
        marginUsed: '2995.7',
        maxLeverage: 20,
        leverage: { type: 'isolated', value: 5 },
      },
    },
    {
      position: {
        coin: 'ETH',
        szi: '12.4',
        entryPx: '2300',
        positionValue: '29906.32',
        liquidationPx: '1995.1',
        marginUsed: '2990.6',
        maxLeverage: 25,
        leverage: { type: 'cross', value: 10 },
      },
    },
    {
      position: {
        coin: 'BTC',
        szi: '-0.01',
        entryPx: '83000',
        positionValue: '830',
        liquidationPx: null,
        marginUsed: '83',
        maxLeverage: 40,
        leverage: { type: 'cross', value: 10 },
      },
    },
  ],
} satisfies { marginSummary: { accountValue: string }; assetPositions: { position: RawPosition }[] };

export const GUARD = {
  guard_id: 'g-7f3a91c2',
  status: 'Guarding',
  created_at: '1762905600000000000',
  expires_at: '1765497600000000000',
  receipt_count: 1,
  arm_count: 2,
};
export const RECEIPTS = [{ public: { at_hour: 1762912800, credit_usd: 2.1, latency_s: 38, outcome: 'early' } }];
export const STATS = { guards: 3, rescues: 4, saves: 1, margin_added_usd: 9.4 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Hyperliquid and NEAR RPC, answering from the fixtures above; `seen` records each request. */
export function publicApis(seen: string[] = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      type?: string;
      params?: { method_name: string; args_base64: string };
    };
    if (String(url).endsWith('/info')) {
      seen.push(`hl ${body.type}`);
      return json(STATE);
    }
    const method = body.params!.method_name;
    const args = JSON.parse(Buffer.from(body.params!.args_base64, 'base64').toString()) as { guard_id?: string };
    seen.push(`near ${method}`);
    const out =
      method === 'get_guard'
        ? args.guard_id === GUARD.guard_id
          ? GUARD
          : null
        : method === 'get_receipts'
          ? RECEIPTS
          : STATS;
    return json({ result: { result: [...Buffer.from(JSON.stringify(out))] } });
  }) as typeof fetch;
}

export const SOURCES = {
  hyperliquid: 'https://hl.test',
  rpc: 'https://rpc.test',
  registry: 'ripcord-registry.near',
};
