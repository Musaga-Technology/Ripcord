// Public reads only: Hyperliquid's info API and the registry's views on NEAR. Nothing here holds a key or signs.
import { parseAccount, type Account } from '@ripcord/shared';

export type Fetch = typeof fetch;

export interface Sources {
  fetch: Fetch;
  /** Hyperliquid's API base. */
  hyperliquid: string;
  /** A NEAR RPC endpoint. */
  rpc: string;
  /** The guard registry contract. */
  registry: string;
}

export const MAINNET = {
  hyperliquid: 'https://api.hyperliquid.xyz',
  rpc: 'https://free.rpc.fastnear.com',
  registry: 'ripcord-registry.near',
} as const;

/** Mainnet unless HL_API, NEAR_RPC or RIPCORD_REGISTRY say otherwise. */
export function sources(env: NodeJS.ProcessEnv = process.env, fetchFn: Fetch = fetch): Sources {
  return {
    fetch: fetchFn,
    hyperliquid: env.HL_API || MAINNET.hyperliquid,
    rpc: env.NEAR_RPC || MAINNET.rpc,
    registry: env.RIPCORD_REGISTRY || MAINNET.registry,
  };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (s: string) => ADDRESS.test(s);

/** The first Hyperliquid address in a piece of text, if any. */
export function findAddress(text: string): string | null {
  return text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/)?.[0] ?? null;
}

/** `0x15a6…9fe3`: enough for its owner to recognise, without repeating it in full. */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`.toLowerCase();

export async function readAccount(s: Sources, address: string): Promise<Account> {
  if (!isAddress(address)) throw new Error('A Hyperliquid address is 0x followed by 40 hex characters.');
  const res = await s.fetch(`${s.hyperliquid}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user: address }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Hyperliquid answered ${res.status}.`);
  return parseAccount((await res.json()) as Parameters<typeof parseAccount>[0]);
}

/** A view call on the registry. */
export async function view<T>(s: Sources, method: string, args: object): Promise<T> {
  const res = await s.fetch(s.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'ripcord-mcp',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: s.registry,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const r = (await res.json()) as { result?: { result?: number[] }; error?: unknown };
  const bytes = r.result?.result;
  if (!bytes) throw new Error(`The registry's ${method} view failed.`);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
}
