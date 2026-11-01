// The two calls a poker makes besides Hyperliquid: the sealed checker over OutLayer's HTTPS API (with Ripcord's
// payment key: the checker's keys derive per caller), and the registry's public account commitment.

type Fetch = typeof fetch;

export interface CheckerConfig {
  api: string;
  /** `<owner>/<project>` */
  project: string;
  paymentKey: string;
}

export function checker(c: CheckerConfig, fetchFn: Fetch = fetch) {
  return async (guardId: string): Promise<string> => {
    const res = await fetchFn(`${c.api}/call/${c.project}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Payment-Key': c.paymentKey },
      body: JSON.stringify({ input: { action: 'check', guard_id: guardId }, async: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return 'error';
    const r = (await res.json()) as { status?: string; output?: unknown };
    const out =
      typeof r.output === 'string' ? (JSON.parse(r.output) as { status?: string }) : (r.output as { status?: string });
    return r.status === 'completed' ? (out?.status ?? 'error') : 'error';
  };
}

/** The registry's `account_commitment` for a guard, or null if there is no such guard. */
export function registry(rpc: string, contract: string, fetchFn: Fetch = fetch) {
  return async (guardId: string): Promise<string | null> => {
    const res = await fetchFn(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'poker',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: contract,
          method_name: 'get_guard',
          args_base64: Buffer.from(JSON.stringify({ guard_id: guardId })).toString('base64'),
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const r = (await res.json()) as { result?: { result?: number[] } };
    const bytes = r.result?.result;
    if (!bytes) throw new Error('registry view failed');
    const g = JSON.parse(Buffer.from(bytes).toString('utf8')) as { account_commitment: string } | null;
    return g?.account_commitment ?? null;
  };
}
