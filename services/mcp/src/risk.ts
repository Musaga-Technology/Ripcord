// A liquidation risk report from public data: an account's positions nearest to liquidation first, and what the
// crash replays say about guarding the nearest one. It never asks for or suggests a guard's settings: those are
// chosen and sealed on the owner's device.
import { readFileSync } from 'node:fs';
import type { Account, Holding } from '@ripcord/shared';

export type Level = 'one wick away' | 'close' | 'worth watching' | 'comfortable';

export interface PositionRisk {
  /** "ETH long" */
  position: string;
  coin: string;
  margin: 'cross' | 'isolated';
  leverage: number;
  notional: number;
  mark: number;
  liquidation: number | null;
  /** Percent the price has to move to reach the liquidation price; null when there is none. */
  distance: number | null;
  level: Level | null;
}

export interface ReplayOdds {
  /** Which replay the figures come from, in words. */
  source: string;
  coin: string;
  leverage: number;
  /** Percent of positions liquidated with no guard. */
  unguarded: number;
  /** With a Balanced guard and a reserve the size of the margin, then twice it. */
  guarded1x: number;
  guarded2x: number;
  /** With the same 1× reserve posted as margin upfront: the most a reserve can do. */
  upfront1x: number;
}

export interface Risk {
  readAt: string;
  accountValue: number;
  positions: PositionRisk[];
  replay: ReplayOdds | null;
}

export function levelOf(distance: number | null): Level | null {
  if (distance === null) return null;
  if (distance < 5) return 'one wick away';
  if (distance < 10) return 'close';
  if (distance < 20) return 'worth watching';
  return 'comfortable';
}

function positionRisk(h: Holding): PositionRisk {
  return {
    position: `${h.coin} ${h.side.toLowerCase()}`,
    coin: h.coin,
    margin: h.margin,
    leverage: h.leverage,
    notional: h.notional,
    mark: h.mark,
    liquidation: h.liquidation,
    distance: h.distance,
    level: levelOf(h.distance),
  };
}

// The replays the set-up screen quotes (`scripts/replay/figures.py`): BTC, ETH, SOL and HYPE at two leverages each,
// positions held a week, reserves at 0.5×, 1× and 2× the margin.
type Cell = { unguarded: number; upfront: number; balanced: { liquidated: number } };
interface ReplayData {
  period: string;
  held_days: number;
  figures: Record<string, Record<string, Record<string, Cell>>>;
}
let replayData: ReplayData | null = null;
const replay = () =>
  (replayData ??= JSON.parse(
    readFileSync(new URL('../../../apps/web/data/replay.json', import.meta.url), 'utf8'),
  ) as ReplayData);

/** The replay closest to a coin and leverage: ETH for a coin the replays didn't run, the nearest leverage they did. */
export function replayOdds(coin: string, leverage: number): ReplayOdds {
  const d = replay();
  const asset = d.figures[coin.toUpperCase()] ? coin.toUpperCase() : 'ETH';
  const levs = Object.keys(d.figures[asset]!).map(Number);
  const lev = levs.reduce((a, b) => (Math.abs(b - leverage) < Math.abs(a - leverage) ? b : a));
  const at = (band: string) => d.figures[asset]![String(lev)]![band]!;
  return {
    source: `${asset} ${lev}× longs and shorts held ${d.held_days} days, ${d.period}, on real one-minute prices`,
    coin: asset,
    leverage: lev,
    unguarded: at('1.0').unguarded,
    guarded1x: at('1.0').balanced.liquidated,
    guarded2x: at('2.0').balanced.liquidated,
    upfront1x: at('1.0').upfront,
  };
}

export function assess(account: Account, now: Date): Risk {
  const positions = account.holdings
    .map(positionRisk)
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  const nearest = positions.find((p) => p.distance !== null);
  return {
    readAt: now.toISOString(),
    accountValue: account.value,
    positions,
    replay: nearest ? replayOdds(nearest.coin, nearest.leverage) : null,
  };
}

const num = (x: number) => x.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const pct = (x: number) => `${x.toFixed(1)}%`;
const usd = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export const REPO = 'https://github.com/Musaga-Technology/Ripcord';

/** The report as Markdown, for an agent to read or a person to keep. */
export function riskMarkdown(r: Risk, o: { account: string; appUrl: string | null }): string {
  const lines = [
    `# Liquidation risk for ${o.account}`,
    '',
    `Read from Hyperliquid's public API at ${when(r.readAt)}. Account value ${usd(r.accountValue)}.`,
    'Every number below is public: anyone can read it, including traders who push the price into liquidation levels.',
    '',
  ];
  if (r.positions.length === 0) {
    lines.push('No open positions on this account, so nothing to liquidate.', '');
  } else {
    lines.push(
      '| Position | Margin | Leverage | Size | Mark | Liquidation | From liquidation |',
      '|---|---|---|---|---|---|---|',
      ...r.positions.map(
        (p) =>
          `| ${p.position} | ${p.margin} | ${p.leverage}× | ${usd(p.notional)} | ${num(p.mark)} | ${
            p.liquidation === null ? 'none' : num(p.liquidation)
          } | ${p.distance === null ? '–' : `${pct(p.distance)} (${p.level})`} |`,
      ),
      '',
    );
    const nearest = r.positions.find((p) => p.distance !== null);
    if (nearest) lines.push(`**Nearest: ${nearest.position}, ${pct(nearest.distance!)} from liquidation.**`, '');
  }
  if (r.replay) {
    const x = r.replay;
    lines.push(
      '## What the replays say',
      '',
      `${x.source}:`,
      '',
      `- No guard: ${x.unguarded}% liquidated.`,
      `- A Ripcord guard (Balanced) with a reserve the size of the margin: ${x.guarded1x}%. With twice the margin: ${x.guarded2x}%.`,
      `- The same reserve posted as margin upfront: ${x.upfront1x}%. A guard comes close to that while the reserve stays out of sight.`,
      '',
    );
  }
  lines.push(
    '## Guard it',
    '',
    'Ripcord keeps a reserve nobody can see and moves it into your margin before the liquidator gets there.',
    o.appUrl ? `Set one up at ${o.appUrl}/guards.` : `See ${REPO} to set one up.`,
    'You choose its settings on your own device, sealed for an enclave on NEAR; this report never sees them.',
    '',
    `Sources: Hyperliquid's info API (\`clearinghouseState\`); Ripcord's replay harness, ${REPO}/tree/main/crates/replay.`,
  );
  return lines.join('\n');
}
