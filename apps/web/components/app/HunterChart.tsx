// What a hunter sees: price and the public liquidation line. When a rescue lands the red line slides away from price
// (DESIGN §8.1, 420 ms), with the old line left dashed behind it.
export function HunterChart({
  pts,
  liq,
  oldLiq,
  landed,
  label,
}: {
  pts: [number, number][];
  liq: number | null;
  oldLiq?: number | null;
  landed?: [number, number] | null;
  label: string;
}) {
  const W = 600;
  const H = 300;
  if (pts.length < 2)
    return <div aria-busy="true" className="h-[240px] animate-pulse rounded-[12px] bg-line/40 sm:h-[300px]" />;
  const t0 = pts[0]![0];
  const t1 = pts[pts.length - 1]![0];
  const prices = pts.map((p) => p[1]);
  const extra = [liq, oldLiq].filter((x): x is number => typeof x === 'number');
  const lo0 = Math.min(...prices, ...extra);
  const hi0 = Math.max(...prices, ...extra);
  const pad = (hi0 - lo0) * 0.06 || hi0 * 0.01;
  const [lo, hi] = [lo0 - pad, hi0 + pad];
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  const line = pts.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[240px] w-full sm:h-[300px]"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d={`${line} L${W} ${H} L0 ${H}Z`} fill="var(--text)" fillOpacity={0.018} />
      <path
        d={line}
        fill="none"
        stroke="var(--text)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {typeof oldLiq === 'number' && (
        <line
          x1={0}
          x2={W}
          y1={y(oldLiq)}
          y2={y(oldLiq)}
          stroke="var(--red)"
          strokeWidth={1}
          strokeDasharray="6 6"
          opacity={0.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {liq !== null && (
        <line
          x1={0}
          x2={W}
          y1={0}
          y2={0}
          stroke="var(--red)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          style={{ transform: `translateY(${y(liq).toFixed(1)}px)`, transition: 'transform var(--dur-3) var(--ease)' }}
        />
      )}
      {landed && x(landed[0]) > 0 && (
        <g transform={`translate(${x(landed[0]).toFixed(1)} ${y(landed[1]).toFixed(1)})`}>
          <circle r={5} fill="var(--green)" />
          <circle
            r={5}
            fill="none"
            stroke="var(--green)"
            strokeWidth={2}
            className="land-ring"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      <circle cx={W} cy={y(pts[pts.length - 1]![1])} r={3.5} fill="var(--text)" />
    </svg>
  );
}
