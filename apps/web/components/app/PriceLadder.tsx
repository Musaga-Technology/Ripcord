// The setup's one picture: where this guard steps in, in prices, between the price now and the public liquidation
// price. Percents from liquidation are what gets sealed; a trader thinks in prices, so the band is drawn and labelled in
// them. Only this device draws it: the band is the sealed part.
import { price } from '../format';

export function PriceLadder({
  side,
  mark,
  liq,
  line,
  target,
}: {
  side: 'Long' | 'Short';
  mark: number;
  liq: number;
  /** The sealed rescue range and top-up range, % from liquidation. */
  line: [number, number];
  target: [number, number];
}) {
  const s = side === 'Long' ? -1 : 1;
  // Where the guard steps in: the price at which the distance from liquidation equals the line, near today's levels.
  const at = (pct: number) => liq / (1 + s * (pct / 100));
  const band: [number, number] = [at(line[0]), at(line[1])];
  // After a rescue the liquidation price moves to sit about the top-up distance below (or above) the price then.
  const mid = (band[0] + band[1]) / 2;
  const after = mid * (1 + s * ((target[0] + target[1]) / 200));
  const all = [mark, liq, after, ...band];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.06;
  const x = (p: number) => ((p - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  const [b0, b1] = [Math.min(x(band[0]), x(band[1])), Math.max(x(band[0]), x(band[1]))];

  return (
    <figure className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel px-5 pb-4 pt-5">
      <div className="relative h-[86px]" aria-hidden="true">
        <div className="absolute inset-x-0 top-[44px] h-px bg-line-3" />
        {/* The rescue band, the sealed part. */}
        <div
          className="absolute top-[34px] h-[21px] rounded-[6px] border border-amber bg-amber/15 transition-all duration-[240ms]"
          style={{ left: `${b0}%`, width: `${Math.max(1.5, b1 - b0)}%` }}
        />
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[13px] font-medium text-amber transition-all duration-[240ms]"
          style={{ left: `${(b0 + b1) / 2}%` }}
        >
          Steps in {price(Math.min(...band))}–{price(Math.max(...band))}
        </span>
        <Tick at={x(liq)} label={`Liq ${price(liq)}`} cls="bg-red" text="text-red" />
        <Tick
          at={x(after)}
          label={
            <>
              <span className="sm:hidden">After ≈ </span>
              <span className="hidden sm:inline">After a rescue ≈ </span>
              {price(after)}
            </>
          }
          cls="bg-red/50"
          text="text-muted"
          up
        />
        <Tick at={x(mark)} label={`Now ${price(mark)}`} cls="bg-text" text="text-text" />
      </div>
      <figcaption className="text-[13px] text-muted">
        Where this guard steps in, in today&apos;s prices. Only you see this band; Hyperliquid shows everyone the red
        line.
      </figcaption>
    </figure>
  );
}

function Tick({
  at,
  label,
  cls,
  text,
  up,
}: {
  at: number;
  label: React.ReactNode;
  cls: string;
  text: string;
  /** Label above the line, out of the way of the ticks below. */
  up?: boolean;
}) {
  // Near either end the label anchors inward, so it never runs off the panel.
  const align =
    at < 18 ? 'items-start -translate-x-px' : at > 82 ? 'items-end -translate-x-full' : 'items-center -translate-x-1/2';
  return (
    <span
      className={`absolute flex gap-1.5 transition-all duration-[240ms] ${align} ${up ? 'top-0 flex-col-reverse' : 'top-[30px] flex-col'}`}
      style={{ left: `${at}%` }}
    >
      <span className={`w-0.5 rounded-full ${cls} ${up ? 'h-[36px]' : 'h-[29px]'}`} />
      <span className={`whitespace-nowrap text-[12px] tabular-nums ${text}`}>{label}</span>
    </span>
  );
}
