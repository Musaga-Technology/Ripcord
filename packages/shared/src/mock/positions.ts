// Demo-mode data: one trader's Hyperliquid account as `clearinghouseState` would describe it, and the guards on
// it. ETH long and BTC short share one cross guard; HYPE isolated is guarded; SOL isolated is left to guard.
// Commitments are computed from real (example) sealed settings, so cards and fingerprints are what a user sees.
import { commitment, fingerprint } from '../commitment';
import { guardDistance, markOf } from '../guard';
import type { GuardSettings, Position } from '../types';

export const DEMO_TRADER = '0x9c4e7a1b2c3d4e5f60718293a4b5c6d7e8f941f2';

export const DEMO_POSITIONS: Position[] = [
  { coin: 'ETH', szi: 12.4, position_value: 29906.32, liquidation_px: 1995.1, leverage_type: 'cross' },
  { coin: 'BTC', szi: -0.8, position_value: 66400, liquidation_px: 98940, leverage_type: 'cross' },
  { coin: 'SOL', szi: 140, position_value: 14978.6, liquidation_px: 87.1, leverage_type: 'isolated' },
  { coin: 'HYPE', szi: 300, position_value: 24594, liquidation_px: 55.3, leverage_type: 'isolated' },
];

export const DEMO_LEVERAGE: Record<string, number> = { ETH: 10, BTC: 5, SOL: 5, HYPE: 3 };

const salt = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

function settings(overrides: Partial<GuardSettings>): GuardSettings {
  return {
    owner: DEMO_TRADER,
    hl_address: DEMO_TRADER,
    account_salt: salt(0xa1),
    preset: 'balanced',
    line_range_pct: [5, 8],
    target_range_pct: [9, 13],
    speed_aware: true,
    max_rescue_usd: 1500,
    budget_usd: 4000,
    reserve_asset: 'nep141:nbtc.bridge.near',
    cooldown_s: 60,
    isolated: null,
    close_hint: null,
    receipt_pk: 'x25519:' + salt(0x5e),
    expires_at: '1795046400000000000',
    ...overrides,
  };
}

export interface DemoGuard {
  guardId: string;
  coin: string;
  label: string;
  settings: GuardSettings;
  commitment: string;
  fingerprint: string;
  /** What the owner sees after peeking: the sealed settings in words. */
  sealed: { reserve: string; range: string; target: string };
}

function guard(
  guardId: string,
  coin: string,
  label: string,
  s: GuardSettings,
  reserve: string,
  saltByte: number,
): DemoGuard {
  const c = commitment(s, salt(saltByte));
  return {
    guardId,
    coin,
    label,
    settings: s,
    commitment: c,
    fingerprint: fingerprint(c),
    sealed: {
      reserve,
      range: `${s.line_range_pct[0]}–${s.line_range_pct[1]}%`,
      target: `${s.target_range_pct[0]}–${s.target_range_pct[1]}%`,
    },
  };
}

export const DEMO_GUARDS: DemoGuard[] = [
  guard('g-vf6per4bfx', 'ETH', 'ETH long · 10×', settings({}), '0.057 BTC', 0x11),
  guard(
    'g-k3m7xq2tpa',
    'BTC',
    'BTC short · 5×',
    settings({
      preset: 'safer',
      line_range_pct: [7, 10],
      target_range_pct: [12, 16],
      reserve_asset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    }),
    '4,200 USDC',
    0x22,
  ),
  guard(
    'g-h2y6wnd4re',
    'HYPE',
    'HYPE long · 3× isolated',
    settings({
      preset: 'lean',
      line_range_pct: [3.5, 5.5],
      target_range_pct: [7, 10],
      speed_aware: true,
      isolated: { coin: 'HYPE' },
    }),
    '86 SOL',
    0x33,
  ),
];

export interface DemoRow {
  coin: string;
  side: 'Long' | 'Short';
  leverage: number;
  margin: 'cross' | 'isolated';
  size: number;
  mark: number;
  liquidation: number | null;
  distance: number | null;
  guard: DemoGuard | null;
}

export function demoRows(positions: Position[] = DEMO_POSITIONS): DemoRow[] {
  return positions.map((p) => ({
    coin: p.coin,
    side: p.szi > 0 ? 'Long' : 'Short',
    leverage: DEMO_LEVERAGE[p.coin] ?? 1,
    margin: p.leverage_type,
    size: Math.abs(p.szi),
    mark: markOf(p),
    liquidation: p.liquidation_px,
    distance: guardDistance([p], p.leverage_type === 'isolated' ? p.coin : null),
    guard: DEMO_GUARDS.find((g) => g.coin === p.coin) ?? null,
  }));
}
