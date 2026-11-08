// What the replays say about a reserve and a preset (`scripts/replay/figures.py`, the tuning months). A position the
// replays didn't run uses the closest they did, and says which.
import type { Preset } from '@ripcord/shared';
import data from '../data/replay.json';

export interface ReplayFigure {
  /** The replay this comes from, in words. */
  source: string;
  unguarded: number;
  upfront: number;
  liquidated: number;
  earlyMonth: number;
  /** The reserve band it was run at. */
  band: number;
}

type Cell = { unguarded: number; upfront: number } & Record<Preset, { liquidated: number; early_month: number }>;
const FIGURES = data.figures as unknown as Record<string, Record<string, Record<string, Cell>>>;
const BANDS = [0.5, 1, 2];

/** The figure for a reserve this many times the margin, from the band at or below it; null under the lowest band. */
export function replayFigure(coin: string, leverage: number, reserveX: number, preset: Preset): ReplayFigure | null {
  const band = [...BANDS].reverse().find((b) => reserveX >= b);
  if (band === undefined) return null;
  const asset = FIGURES[coin] ? coin : 'ETH';
  const levs = Object.keys(FIGURES[asset]!).map(Number);
  const lev = levs.reduce((a, b) => (Math.abs(b - leverage) < Math.abs(a - leverage) ? b : a));
  const cell = FIGURES[asset]![String(lev)]![band.toFixed(1)]!;
  return {
    source: `Replay of ${asset} ${lev}× longs and shorts held a week, ${data.period}.`,
    unguarded: cell.unguarded,
    upfront: cell.upfront,
    liquidated: cell[preset].liquidated,
    earlyMonth: cell[preset].early_month,
    band,
  };
}

const ALL: Preset[] = ['safer', 'balanced', 'lean'];

/**
 * The choice marked for you: the preset with the lowest share liquidated in the replays at this reserve, and among
 * equals the fewest close calls a month. Balanced when the replays don't cover the reserve.
 */
export function markedPreset(coin: string, leverage: number, reserveX: number): Preset {
  const figs = ALL.map((p) => [p, replayFigure(coin, leverage, reserveX, p)] as const).filter(([, f]) => f !== null);
  if (figs.length === 0) return 'balanced';
  figs.sort(([, a], [, b]) => a!.liquidated - b!.liquidated || a!.earlyMonth - b!.earlyMonth);
  return figs[0]![0];
}
