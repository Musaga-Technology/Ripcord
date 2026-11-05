// The hunt: the visitor plays the hunter against a guarded ETH long. Every push sells into the book, moving the price
// down at a cost that grows as the book thins, at most once per 3 s while the book refills; the market slowly buys
// the dip back. Tuned so that a hunter selling every tick liquidates the same position unguarded every time
// (`liquidatedWithout`), and the hidden reserve holds against it. The guard can't be seen: it
// checks every 3 s with the enclave's rules and rescues from a reserve nobody can see. Time runs at 10×.
import { gauss, GuardedPosition, liqPrice, rng, type GuardSpec, type PositionSpec } from './sim';

export const TICK_S = 3;
export const POS: PositionSpec = { side: 1, entry: 2460, notional: 32_900, leverage: 10, mm: 0.02 };
export const GUARD: GuardSpec = {
  lineRange: [4.4, 5.6],
  targetRange: [8.0, 9.4],
  speedAware: true,
  reserveX: 2,
  landS: 38,
  cooldownS: 30,
};
export const BUDGET = 1_600_000;
/** One push sells this fraction of the price into the book. */
export const PUSH = 0.006;
/** The pressure left after each 3 s: the market buys the dip back. */
export const DECAY = 0.97;

export interface Hunt {
  t: number;
  fair: number;
  pressure: number;
  spent: number;
  pushes: number;
  pts: [number, number][];
  liqPts: [number, number][];
  feed: { t: number; text: string }[];
  guard: GuardedPosition;
  over: null | 'liquidated' | 'broke' | 'time';
  u: () => number;
  seed: number;
  /** The tick of each sale, to replay the same attack without a guard. */
  sales: number[];
}

export const price = (h: Hunt) => h.fair * (1 - h.pressure);
/** What the next push costs: thinner book, dearer push. */
export const pushCost = (h: Hunt) => 50_000 * (1 + 10 * h.pressure);
/** The book refills between sales: one per 3 s. */
export const canPush = (h: Hunt) => !h.over && h.sales.at(-1) !== h.t && h.spent + pushCost(h) <= BUDGET;

export function start(seed: number): Hunt {
  const u = rng(seed);
  const guard = new GuardedPosition(POS, GUARD, u);
  const h: Hunt = {
    t: 0,
    fair: POS.entry,
    pressure: 0,
    spent: 0,
    pushes: 0,
    pts: [],
    liqPts: [],
    feed: [],
    guard,
    over: null,
    u,
    seed,
    sales: [],
  };
  h.pts.push([0, price(h)]);
  h.liqPts.push([0, guard.liq]);
  // Thirty seconds of market before the hunter arrives, so the chart has a past.
  for (let i = 0; i < 10; i++) tick(h);
  return h;
}

const usd = (x: number) =>
  x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1000)}K` : `$${Math.round(x)}`;

/** The hunter sells: the price drops now, the cost is paid now. */
export function push(h: Hunt): boolean {
  if (h.over || h.sales.at(-1) === h.t) return false;
  const cost = pushCost(h);
  if (h.spent + cost > BUDGET) {
    h.over = 'broke';
    return false;
  }
  h.spent += cost;
  h.pushes += 1;
  h.sales.push(h.t);
  h.pressure = 1 - (1 - h.pressure) * (1 - PUSH);
  h.pts.push([h.t, price(h)]);
  h.feed.unshift({
    t: h.t,
    text: `You sold ${usd(cost)} into the book · ETH ${price(h).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`,
  });
  check(h);
  return true;
}

/** Where a liquidation would happen if it happened now (it's public). */
export const liquidationNow = (h: Hunt) => h.guard.liq;

function check(h: Hunt) {
  if (h.over) return;
  const before = h.guard.liq;
  const ev = h.guard.observe(h.t, price(h));
  if (ev === 'liquidated') {
    h.over = 'liquidated';
    h.feed.unshift({ t: h.t, text: 'Liquidated at the public price' });
  }
  if (ev === 'landed') {
    const r = h.guard.rescues[h.guard.rescues.length - 1]!;
    h.feed.unshift({
      t: h.t,
      text: `Margin appeared on the position: +${Math.round(r.amount).toLocaleString('en-US')} USDC, from nowhere you can see`,
    });
    h.liqPts.push([h.t, before], [h.t, h.guard.liq]);
  }
}

/** Three seconds pass: the market absorbs the pressure, the guard checks. */
export function tick(h: Hunt) {
  if (h.over) return;
  h.t += TICK_S;
  h.fair *= 1 + 0.0006 * gauss(h.u);
  h.pressure *= DECAY;
  h.pts.push([h.t, price(h)]);
  h.liqPts.push([h.t, h.guard.liq]);
  check(h);
  if (!h.over && h.t >= 600) h.over = 'time';
}

/** The same sales against the same position with no reserve: which sale would have liquidated it (1-based). */
export function liquidatedWithout(h: Hunt): number | null {
  const g = start(h.seed);
  g.guard.left = 0;
  let n = 0;
  for (let t = 0; t <= h.t; t += TICK_S) {
    while (g.t < t) tick(g);
    if (h.sales.includes(t)) {
      n += 1;
      g.spent = 0; // the same sale, whatever it cost: only where the price goes matters here
      push(g);
    }
    if (g.over === 'liquidated') return n;
  }
  return null;
}

/** Where the sealed lines were, in price: what the reveal draws. */
export function sealedLines(h: Hunt): { from: number; price: number; pct: number }[] {
  const lines = h.guard.rescues.map((r) => ({ from: r.firedAt, pct: r.line, liq: r.liqBefore }));
  lines.push({ from: h.guard.rescues.at(-1)?.landedAt ?? 0, pct: h.guard.line, liq: h.guard.liq });
  return lines.map((l) => ({ from: l.from, pct: l.pct, price: l.liq / (1 - l.pct / 100) }));
}

export { liqPrice };
