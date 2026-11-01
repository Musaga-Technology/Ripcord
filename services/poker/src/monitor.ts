// The payment key pays for every check: if it runs dry, every guard stops at once (a 402). Read its public balance
// and warn while there are still 7 days of runway (docs/ARCHITECTURE.md §8).

type Fetch = typeof fetch;

export interface Sample {
  at: number;
  available: number;
}

/** Days left at the spend rate between the first and last sample; Infinity while nothing is being spent. */
export function runwayDays(samples: Sample[]): number {
  if (samples.length < 2) return Infinity;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const days = (last.at - first.at) / 86_400_000;
  const spent = first.available - last.available;
  if (days <= 0 || spent <= 0) return Infinity;
  return last.available / (spent / days);
}

/** `<owner>:<nonce>:<secret>` → the public balance endpoint's answer, in USD. The secret is never sent. */
export function balance(api: string, paymentKey: string, fetchFn: Fetch = fetch) {
  const [owner, nonce] = paymentKey.split(':');
  return async (): Promise<number> => {
    const res = await fetchFn(`${api}/public/payment-keys/${owner}/${nonce}/balance`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`balance: HTTP ${res.status}`);
    const b = (await res.json()) as { available: string };
    return Number(b.available) / 1e6;
  };
}
