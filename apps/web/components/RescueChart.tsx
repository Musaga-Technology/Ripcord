// What a hunter sees: price and the public liquidation line, read the way Hyperliquid's own chart reads, with a price
// tag and a liquidation tag on the right edge and a price axis. The price range is fixed by the caller for a whole run,
// so when a rescue lands the red line itself slides away from price (DESIGN §8.1, 420 ms) and leaves the old line
// dashed behind it; nothing rescales. Lines are SVG; labels and dots are HTML, so they never stretch with the plot.
import { price } from './format';

export interface RescueChartProps {
  pts: [number, number][];
  /** The time window shown, in the same units as `pts`. */
  t0: number;
  t1: number;
  /** The price range, fixed for the run. */
  lo: number;
  hi: number;
  liq: number | null;
  oldLiq?: number | null;
  /** Where rescues landed, as (time, price). */
  landed?: [number, number][] | [number, number] | null;
  /** Bottom-axis labels for a time. */
  timeLabel?: (t: number) => string;
  label: string;
}

const W = 1000;
const H = 400;

function ticksFor(lo: number, hi: number): number[] {
  const span = hi - lo;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v < hi; v += step) out.push(v);
  return out;
}

export function RescueChart({ pts, t0, t1, lo, hi, liq, oldLiq, landed, timeLabel, label }: RescueChartProps) {
  if (pts.length < 2 || hi <= lo) {
    return <div aria-busy="true" className="h-[240px] animate-pulse rounded-[12px] bg-line/40 sm:h-[300px]" />;
  }
  const x = (t: number) => ((t - t0) / Math.max(1e-9, t1 - t0)) * W;
  const yPct = (p: number) => Math.min(100, Math.max(0, ((hi - p) / (hi - lo)) * 100));
  const y = (p: number) => (yPct(p) / 100) * H;
  const vis = pts.filter(([t]) => t >= t0 - 2);
  const line = vis.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const last = vis[vis.length - 1]!;
  const ticks = ticksFor(lo, hi);
  const near = (a: number, b: number) => Math.abs(yPct(a) - yPct(b)) < 7;
  const landings: [number, number][] = !landed
    ? []
    : Array.isArray(landed[0])
      ? (landed as [number, number][])
      : [landed as [number, number]];
  // Tags never overlap: sorted top to bottom, each sits at least a tag's height below the one above.
  const GAP = 7;
  const tags = [
    { k: 'mark', y: yPct(last[1]) },
    ...(liq !== null ? [{ k: 'liq', y: yPct(liq) }] : []),
    ...(typeof oldLiq === 'number' ? [{ k: 'old', y: yPct(oldLiq) }] : []),
  ].sort((a, b) => a.y - b.y);
  for (let i = 1; i < tags.length; i++) tags[i]!.y = Math.max(tags[i]!.y, tags[i - 1]!.y + GAP);
  const tagY = (k: string) => tags.find((t) => t.k === k)?.y ?? 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-[240px] sm:h-[300px]">
        {/* The plot, with a gutter on the right for the axis and the tags. */}
        <div className="absolute inset-y-0 left-0 right-[68px] overflow-hidden">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={label}
          >
            {ticks.map((v) => (
              <line
                key={v}
                x1={0}
                x2={W}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--line)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d={`${line} L${x(last[0]).toFixed(1)} ${H} L${x(vis[0]![0]).toFixed(1)} ${H}Z`}
              fill="var(--text)"
              fillOpacity={0.025}
            />
            {typeof oldLiq === 'number' && (
              <line
                x1={0}
                x2={W}
                y1={y(oldLiq)}
                y2={y(oldLiq)}
                stroke="var(--red)"
                strokeWidth={1.25}
                strokeDasharray="6 6"
                opacity={0.7}
                vectorEffect="non-scaling-stroke"
                className="reveal-line"
              />
            )}
            <path
              d={line}
              fill="none"
              stroke="var(--text)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
          {liq !== null && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-full"
              style={{
                transform: `translateY(${yPct(liq).toFixed(2)}%)`,
                transition: 'transform var(--dur-3) var(--ease)',
              }}
            >
              <div className="h-0 border-t-2 border-red" />
            </div>
          )}
          {landings
            .filter(([t]) => x(t) >= 0)
            .map(([t, p]) => (
              <span
                key={t}
                aria-hidden="true"
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${(x(t) / W) * 100}%`, top: `${yPct(p)}%` }}
              >
                <span className="block h-2.5 w-2.5 rounded-full bg-green" />
                <span className="land-pulse absolute inset-0 rounded-full border-2 border-green" />
              </span>
            ))}
          <span
            aria-hidden="true"
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text"
            style={{ left: `${(x(last[0]) / W) * 100}%`, top: `${yPct(last[1])}%` }}
          />
        </div>

        {/* The right axis: prices, then the tags on top of them. */}
        <div aria-hidden="true" className="absolute inset-y-0 right-0 w-[64px] text-[11px] tabular-nums text-muted">
          {ticks
            .filter((v) => !near(v, last[1]) && (liq === null || !near(v, liq)) && (oldLiq == null || !near(v, oldLiq)))
            .map((v) => (
              <span key={v} className="absolute left-1.5 -translate-y-1/2" style={{ top: `${yPct(v)}%` }}>
                {price(v)}
              </span>
            ))}
          {typeof oldLiq === 'number' && (
            <span
              className="reveal-line absolute left-0 -translate-y-1/2 rounded-[4px] border border-dashed border-red bg-panel px-1 py-px text-red"
              style={{ top: `${tagY('old')}%` }}
            >
              {price(oldLiq)}
            </span>
          )}
          {liq !== null && (
            <span
              className="absolute inset-x-0 top-0 h-full"
              style={{
                transform: `translateY(${tagY('liq').toFixed(2)}%)`,
                transition: 'transform var(--dur-3) var(--ease)',
              }}
            >
              <span className="absolute left-0 top-0 -translate-y-1/2 rounded-[4px] bg-red px-1 py-px font-medium text-ground">
                {price(liq)}
              </span>
            </span>
          )}
          <span
            className="absolute left-0 -translate-y-1/2 rounded-[4px] bg-text px-1 py-px font-medium text-ground"
            style={{ top: `${tagY('mark')}%` }}
          >
            {price(last[1])}
          </span>
        </div>
      </div>
      {timeLabel && (
        <div aria-hidden="true" className="mr-[68px] flex justify-between text-[11px] tabular-nums text-muted">
          <span>{timeLabel(t0)}</span>
          <span>{timeLabel((t0 + t1) / 2)}</span>
          <span>{timeLabel(t1)}</span>
        </div>
      )}
    </div>
  );
}

/** A price range for a run: everything it will show, with room above and below. */
export function rangeOf(prices: number[], pad = 0.08): [number, number] {
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const m = (hi - lo) * pad || hi * 0.005;
  return [lo - m, hi + m];
}
