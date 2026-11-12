import edge from '../../data/edge.json';
import { Reveal } from './Reveal';
import { Turned, display } from '../Display';

// "The edge, right now.": the largest positions near liquidation in a scan of public Hyperliquid data
// (scripts/scan/edge.py: the 1,500 largest accounts, addresses never written). Re-run before the video and the
// submission; the date on screen is the scan's.

interface Row {
  coin: string;
  side: string;
  notional: number;
  leverage: number;
  margin: string;
  distance_pct: number;
}

const money = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x / 1e3)}K`;
const date = (iso: string) =>
  new Date(iso.replace('Z', ':00Z')).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function Edge() {
  // Nearest to liquidation first; a bar fills as a position nears its line (full at 0%, empty at 10% away).
  const rows = [...(edge.top as Row[])].sort((a, b) => a.distance_pct - b.distance_pct);
  const when = date(edge.scanned_at);
  const isolated = edge.within_5_count > 0 && edge.within_5_isolated === edge.within_5_count;
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-end">
      <Reveal className="flex min-w-0 flex-col gap-5">
        <h2 className={`${display} text-[44px] leading-[1] sm:text-[72px]`}>
          <Turned>The edge, right now.</Turned>
        </h2>
        <p className="max-w-[30rem] text-[17px] text-text-2">
          On {when}, {money(edge.within_10_usd)} in the {edge.accounts.toLocaleString('en-US')} largest Hyperliquid
          accounts sat within 10% of liquidation.
          {isolated
            ? ` ${edge.within_5_count === 2 ? 'Both positions' : `All ${edge.within_5_count} positions`} within 5% were isolated. Below, the five largest near the edge.`
            : ''}
        </p>
      </Reveal>
      <Reveal className="min-w-0">
        {/* Phone: one row per position, the distance bar full width under it. */}
        <ul className="flex flex-col sm:hidden">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-col gap-2 border-b border-line py-3.5 tabular-nums">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {r.coin} {r.side} · {money(r.notional)}
                </span>
                <span className={r.distance_pct < 5 ? 'text-red' : ''}>{r.distance_pct.toFixed(1)}%</span>
              </span>
              <span className="text-[13px] text-text-2">
                {r.leverage}× {r.margin}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(4, Math.min(100, (10 - r.distance_pct) * 10))}%`,
                    background:
                      r.distance_pct < 5 ? 'var(--red)' : r.distance_pct < 10 ? 'var(--amber)' : 'var(--muted)',
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[520px] text-left text-[15px] tabular-nums">
            <thead className="text-[13px] text-muted">
              <tr className="border-b border-line">
                <th className="py-3 font-normal">Position</th>
                <th className="py-3 font-normal">Size</th>
                <th className="py-3 font-normal">Leverage</th>
                <th className="w-[38%] py-3 font-normal">From liquidation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-3.5 font-medium">
                    {r.coin} {r.side}
                  </td>
                  <td className="py-3.5">{money(r.notional)}</td>
                  <td className="py-3.5 text-text-2">
                    {r.leverage}× {r.margin}
                  </td>
                  <td className="py-3.5">
                    <span className="flex items-center gap-3">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(4, Math.min(100, (10 - r.distance_pct) * 10))}%`,
                            background:
                              r.distance_pct < 5 ? 'var(--red)' : r.distance_pct < 10 ? 'var(--amber)' : 'var(--muted)',
                          }}
                        />
                      </span>
                      <span className={`w-12 text-right ${r.distance_pct < 5 ? 'text-red' : ''}`}>
                        {r.distance_pct.toFixed(1)}%
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Public Hyperliquid data, the {edge.accounts.toLocaleString('en-US')} largest accounts by value, {when}.
          Addresses left out. Each of these liquidation prices is visible to anyone.
        </p>
      </Reveal>
    </div>
  );
}
