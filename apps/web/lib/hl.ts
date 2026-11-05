// Hyperliquid's public info API, read from the owner's browser, so Ripcord's servers never learn which account is
// behind a session. Shapes as read from mainnet (Nov 1–5 2026): numbers arrive as strings, `liquidationPx` can be null.
const API = 'https://api.hyperliquid.xyz';

export interface Holding {
  coin: string;
  szi: number;
  size: number;
  side: 'Long' | 'Short';
  mark: number;
  entry: number;
  liquidation: number | null;
  distance: number | null;
  leverage: number;
  margin: 'cross' | 'isolated';
  marginUsed: number;
  maxLeverage: number;
  notional: number;
}

export interface Account {
  value: number;
  holdings: Holding[];
}

async function info<T>(body: unknown): Promise<T> {
  const r = await fetch(`${API}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('hyperliquid');
  return (await r.json()) as T;
}

interface RawPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
  leverage: { type: 'cross' | 'isolated'; value: number };
}

export function parseAccount(state: {
  assetPositions: { position: RawPosition }[];
  marginSummary: { accountValue: string };
}): Account {
  const holdings = state.assetPositions
    .map(({ position: p }): Holding => {
      const szi = Number(p.szi);
      const size = Math.abs(szi);
      const notional = Number(p.positionValue);
      const mark = size > 0 ? notional / size : 0;
      const liquidation = p.liquidationPx === null ? null : Number(p.liquidationPx);
      return {
        coin: p.coin,
        szi,
        size,
        side: szi > 0 ? 'Long' : 'Short',
        mark,
        entry: Number(p.entryPx),
        liquidation,
        distance: liquidation === null || mark === 0 ? null : (Math.abs(liquidation - mark) / mark) * 100,
        leverage: p.leverage.value,
        margin: p.leverage.type,
        marginUsed: Number(p.marginUsed),
        maxLeverage: p.maxLeverage,
        notional,
      };
    })
    .filter((h) => h.size > 0);
  return { value: Number(state.marginSummary.accountValue), holdings };
}

export async function readAccount(user: string): Promise<Account> {
  return parseAccount(await info({ type: 'clearinghouseState', user }));
}

export interface Agent {
  name: string;
  address: string;
  validUntil?: number;
}

export const readAgents = (user: string) => info<Agent[]>({ type: 'extraAgents', user });

/** One-minute closes for the hour before now: what the chart opens with. */
export async function readCandles(coin: string, now: number): Promise<[number, number][]> {
  const bars = await info<{ t: number; c: string }[]>({
    type: 'candleSnapshot',
    req: { coin, interval: '1m', startTime: now - 3_600_000, endTime: now },
  });
  return bars.map((b): [number, number] => [b.t / 1000, Number(b.c)]);
}

export async function readMark(coin: string): Promise<number | null> {
  const mids = await info<Record<string, string>>({ type: 'allMids' });
  const m = mids[coin];
  return m === undefined ? null : Number(m);
}

export async function postExchange(body: unknown): Promise<{ status: string; response?: unknown }> {
  const r = await fetch(`${API}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as { status: string; response?: unknown };
}
