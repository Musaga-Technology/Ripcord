// The poker: `corepack pnpm --filter @ripcord/poker start`. Configuration from the environment (see .env.example).
import { DEFAULT_BAND } from './band';
import { checker, registry } from './clients';
import { hyperliquid } from './hl';
import { balance, runwayDays, type Sample } from './monitor';
import { server } from './server';
import { Store } from './store';
import { Watcher } from './watch';

const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === '') throw new Error(`${k} is not set`);
  return v;
};

const store = new Store(env('POKER_STORE', 'poker-watch.json'), env('POKER_STORE_KEY'));
const watcher = new Watcher(
  hyperliquid(env('HYPERLIQUID_API_BASE', 'https://api.hyperliquid.xyz')),
  checker({
    api: env('OUTLAYER_API_BASE'),
    project: env('CHECKER_PROJECT'),
    paymentKey: env('OUTLAYER_PAYMENT_KEY'),
  }),
  { ...DEFAULT_BAND, bandPct: Number(env('POKER_BAND_PCT', String(DEFAULT_BAND.bandPct))) },
);
for (const g of store.load()) watcher.add(g);

const port = Number(env('POKER_PORT', '8787'));
server(watcher, store, registry(env('NEAR_RPC'), env('REGISTRY_CONTRACT'))).listen(port, () =>
  console.log(`poker on :${port}, watching ${watcher.list().length} guards`),
);

let busy = false;
setInterval(
  () => {
    if (busy) return;
    busy = true;
    watcher
      .tick(Date.now())
      .then((calls) => {
        // Guard ids, reasons, statuses and timings only: never an address.
        for (const c of calls) {
          console.log(`${c.guardId} ${c.reason} → ${c.status} in ${c.ms} ms`);
          if (c.alert) console.log(`ALERT ${c.guardId}: ${c.alert}`);
        }
      })
      .catch((e: unknown) => console.log(`tick failed: ${(e as Error).message}`))
      .finally(() => (busy = false));
  },
  Number(env('POKER_INTERVAL_MS', '1000')),
);

// The payment key's runway, every 10 minutes over the last 24 hours of samples.
const readBalance = balance(env('OUTLAYER_API_BASE'), env('OUTLAYER_PAYMENT_KEY'));
const samples: Sample[] = [];
const watchBalance = () =>
  readBalance()
    .then((available) => {
      const now = Date.now();
      samples.push({ at: now, available });
      while (samples.length > 1 && now - samples[0]!.at > 86_400_000) samples.shift();
      const days = runwayDays(samples);
      if (days < 7) console.log(`ALERT payment key: $${available.toFixed(2)} left, ${days.toFixed(1)} days of runway`);
    })
    .catch((e: unknown) => console.log(`balance read failed: ${(e as Error).message}`));
void watchBalance();
setInterval(() => void watchBalance(), 600_000);
