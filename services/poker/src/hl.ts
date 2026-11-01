// Public Hyperliquid reads, the only data a poker sees (docs/SPEC.md §4): `allMids` for prices and
// `clearinghouseState` for liquidation prices, both weight 2 of the 1,200 per minute per IP.

export interface HlPosition {
  coin: string;
  szi: number;
  liquidationPx: number | null;
}

export interface Hyperliquid {
  state(address: string): Promise<HlPosition[]>;
  mids(): Promise<Record<string, number>>;
}

type Fetch = typeof fetch;

export function hyperliquid(api = 'https://api.hyperliquid.xyz', fetchFn: Fetch = fetch): Hyperliquid {
  const info = async (body: object): Promise<unknown> => {
    const res = await fetchFn(`${api}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`hyperliquid: HTTP ${res.status}`);
    return res.json();
  };
  return {
    async state(address) {
      const s = (await info({ type: 'clearinghouseState', user: address })) as {
        assetPositions: { position: { coin: string; szi: string; liquidationPx: string | null } }[];
      };
      return s.assetPositions
        .map(({ position: p }) => ({
          coin: p.coin,
          szi: Number(p.szi),
          liquidationPx: p.liquidationPx === null ? null : Number(p.liquidationPx),
        }))
        .filter((p) => p.szi !== 0);
    },
    async mids() {
      const m = (await info({ type: 'allMids' })) as Record<string, string>;
      return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v)]));
    },
  };
}

/**
 * The nearest liquidation over every position, in %. A poker can't know which positions a guard covers (that is
 * sealed), so it watches them all: it may call more often than needed, never less.
 */
export interface Nearest {
  coin: string;
  distance: number;
  liq: number;
}

export function nearest(positions: HlPosition[], mids: Record<string, number>): Nearest | null {
  let best: Nearest | null = null;
  for (const p of positions) {
    const mid = mids[p.coin];
    if (p.liquidationPx === null || !mid) continue;
    const distance = (Math.abs(p.liquidationPx - mid) / mid) * 100;
    if (!best || distance < best.distance) best = { coin: p.coin, distance, liq: p.liquidationPx };
  }
  return best;
}
