'use client';

import { useInView } from './Reveal';

// "Your liquidation price is public.": liquidation levels under the price, as heatmap tools draw them, as slabs in a
// shallow 3D stack. Labels stay flat and readable; the slabs rise in turn when seen. Yours is red. An illustration,
// labelled as one.

const LEVELS: [string, number, boolean?][] = [
  ['2,410', 18],
  ['2,380', 34],
  ['2,350', 52],
  ['2,320', 41],
  ['2,290', 77],
  ['2,260', 63],
  ['2,231', 30, true],
  ['2,200', 88],
  ['2,170', 45],
];
/** The widest slab, as a share of the track: room is left for the "Your position" label. */
const MAX_SHARE = 0.82;

export function Levels() {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref}>
      <div className="levels" aria-hidden="true">
        <div className="levels-row levels-now">
          <span className="levels-label text-text">ETH 2,461</span>
          <span className="levels-price" />
        </div>
        {LEVELS.map(([price, w, mine], i) => (
          <div key={price} className="levels-row">
            <span className={`levels-label ${mine ? 'font-semibold text-red' : ''}`}>{price}</span>
            <span className="levels-track">
              <span
                className={`slab ${mine ? 'mine' : ''} ${seen ? 'up' : ''}`}
                style={{
                  ['--w' as string]: `${(w * MAX_SHARE).toFixed(1)}%`,
                  transitionDelay: `${120 + i * 70}ms`,
                }}
              >
                <i className="f front" />
                <i className="f top" />
                <i className="f side" />
              </span>
              {mine && (
                <span className="levels-mine" style={{ left: `calc(${(w * MAX_SHARE).toFixed(1)}% + 28px)` }}>
                  Your position
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <ul className="sr-only">
        {LEVELS.map(([price, w, mine]) => (
          <li key={price}>
            Liquidations at {price}: {w}% of the largest level{mine ? ' (your position)' : ''}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[13px] text-muted">
        Illustration: liquidation levels below ETH 2,461, as public heatmap tools draw them.
      </p>
    </div>
  );
}
