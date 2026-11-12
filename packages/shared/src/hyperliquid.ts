// A Hyperliquid account as its public `clearinghouseState` returns it, in numbers: numbers arrive as strings and
// `liquidationPx` can be null. The web app reads it in the owner's browser; the agent tools read it for whoever asks.

export interface Holding {
  coin: string;
  szi: number;
  size: number;
  side: 'Long' | 'Short';
  mark: number;
  entry: number;
  liquidation: number | null;
  distance: number | null;
  leverage: number;
  margin: 'cross' | 'isolated';
  marginUsed: number;
  maxLeverage: number;
  notional: number;
}

export interface Account {
  value: number;
  holdings: Holding[];
}

export interface RawPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
  leverage: { type: 'cross' | 'isolated'; value: number };
}

export function parseAccount(state: {
  assetPositions: { position: RawPosition }[];
  marginSummary: { accountValue: string };
}): Account {
  const holdings = state.assetPositions
    .map(({ position: p }): Holding => {
      const szi = Number(p.szi);
      const size = Math.abs(szi);
      const notional = Number(p.positionValue);
      const mark = size > 0 ? notional / size : 0;
      const liquidation = p.liquidationPx === null ? null : Number(p.liquidationPx);
      return {
        coin: p.coin,
        szi,
        size,
        side: szi > 0 ? 'Long' : 'Short',
        mark,
        entry: Number(p.entryPx),
        liquidation,
        distance: liquidation === null || mark === 0 ? null : (Math.abs(liquidation - mark) / mark) * 100,
        leverage: p.leverage.value,
        margin: p.leverage.type,
        marginUsed: Number(p.marginUsed),
        maxLeverage: p.maxLeverage,
        notional,
      };
    })
    .filter((h) => h.size > 0);
  return { value: Number(state.marginSummary.accountValue), holdings };
}
