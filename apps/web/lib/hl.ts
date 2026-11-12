// Hyperliquid's public info API, read from the owner's browser, so Ripcord's servers never learn which account is
// behind a session. Parsing lives in @ripcord/shared, which the agent tools use too.
import { parseAccount, type Account } from '@ripcord/shared';

export { parseAccount, type Account, type Holding } from '@ripcord/shared';

const API = 'https://api.hyperliquid.xyz';

async function info<T>(body: unknown): Promise<T> {
  const r = await fetch(`${API}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('hyperliquid');
  return (await r.json()) as T;
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
