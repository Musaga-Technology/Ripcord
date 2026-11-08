import type { ReactNode } from 'react';
import { rosette } from '@ripcord/shared';

export type CardState = 'guarded' | 'rescuing' | 'rescued' | 'paused' | 'draft';

const DOT: Record<CardState, string> = {
  guarded: 'var(--card-amber)',
  rescuing: 'var(--card-amber)',
  rescued: 'var(--card-green)',
  paused: 'var(--card-red)',
  draft: 'var(--card-muted)',
};

export interface GuardCardProps {
  label: string;
  distance: ReactNode;
  sub: string;
  fingerprint: string;
  commitment: string;
  state: CardState;
  status: string;
  reserve: string;
  /** The rosette prints itself onto the card (DESIGN §8.1, the seal), once, on mount. */
  print?: boolean;
  /** Lifts the content off the rosette for a 3D shell (`Card3D`). */
  depth?: boolean;
}

/** The guard as a card (docs/DESIGN.md §1): dark in both themes, its rosette drawn from the commitment hash. */
export function GuardCard(p: GuardCardProps) {
  const r = rosette(p.commitment);
  const draw = p.print ? 'card-print' : undefined;
  return (
    <div
      className="card-dark relative w-full font-sans"
      style={{
        aspectRatio: '1.586',
        containerType: 'inline-size',
        transformStyle: 'preserve-3d',
        color: 'var(--card-text)',
      }}
    >
      <div
        className="absolute inset-0 overflow-hidden rounded-[22px] border sm:rounded-[28px]"
        style={{ background: 'var(--card)', borderColor: 'var(--card-line)' }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 600 378"
          preserveAspectRatio="xMidYMid slice"
          className={`absolute inset-0 h-full w-full ${draw ?? ''}`}
        >
          <path
            d={r.outer}
            pathLength={1}
            fill="none"
            stroke="var(--card-rosette)"
            strokeWidth={0.7}
            opacity={0.9}
            vectorEffect="non-scaling-stroke"
            className="rosette-outer"
          />
          <path
            d={r.inner}
            pathLength={1}
            fill="none"
            stroke="var(--card-amber)"
            strokeWidth={0.6}
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
            className="rosette-inner"
          />
        </svg>
      </div>
      <div
        className="absolute inset-0 flex flex-col justify-between"
        style={{
          padding: 'clamp(18px, 5.2cqw, 32px)',
          transform: p.depth ? 'translateZ(28px)' : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span style={{ fontSize: 'clamp(13px, 2.6cqw, 17px)', color: 'var(--card-text-2)' }} className="font-medium">
            {p.label}
          </span>
          <span
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 font-medium transition-colors duration-[240ms]"
            style={{
              fontSize: 'clamp(12px, 2.25cqw, 15px)',
              background: 'var(--card-chip)',
              borderColor: p.state === 'rescued' ? 'var(--card-green)' : 'var(--card-chip-line)',
            }}
          >
            <span
              className={`h-[7px] w-[7px] rounded-full ${p.state === 'rescuing' ? 'chip-pulse' : ''}`}
              style={{ background: DOT[p.state] }}
            />
            <span aria-live="polite">{p.status}</span>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="font-semibold leading-none tabular-nums"
            style={{ fontSize: 'clamp(40px, 12.3cqw, 76px)', letterSpacing: '-0.05em' }}
          >
            {p.distance}
          </span>
          <span style={{ fontSize: 'clamp(12px, 2.75cqw, 17px)', color: 'var(--card-muted)' }}>{p.sub}</span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <span
            className="whitespace-nowrap font-mono"
            style={{ fontSize: 'clamp(11px, 2.4cqw, 15px)', letterSpacing: '0.18em', color: 'var(--card-text-2)' }}
          >
            {p.fingerprint}
          </span>
          {/* A backing of the card's own material, so the rosette never runs through the label or the dots. */}
          <span
            className="flex flex-col items-end gap-0.5 rounded-[8px] px-2 py-1"
            style={{ background: 'color-mix(in srgb, var(--card) 86%, transparent)', marginRight: '-0.5rem' }}
          >
            <span style={{ fontSize: 'clamp(11px, 1.95cqw, 13px)', color: 'var(--card-muted)' }}>Reserve</span>
            <span
              className="whitespace-nowrap font-mono"
              style={{ fontSize: 'clamp(11px, 2.4cqw, 15px)', letterSpacing: '0.2em' }}
            >
              {p.reserve}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
