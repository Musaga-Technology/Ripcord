// What a reserve can be: each asset funds from its own chain and stays in that asset until a rescue swaps it to USDC.
// Ids are 1Click's (`GET /v0/tokens`, read Nov 5 2026). USDC can come from any chain and arrives as NEAR USDC.
export interface ReserveAsset {
  symbol: string;
  name: string;
  chain: string;
  /** What the owner sends. */
  source: string;
  /** What the reserve holds. */
  reserve: string;
  /** Decimals shown when the amount is typed or suggested. */
  digits: number;
  /** "Reserve not seen yet." and how long the deposit usually takes. */
  wait: string;
  /** An example price, for demo mode only. */
  demoPrice: number;
  /** Sent on top of the amount: a send from Hyperliquid carries $1 for the transfer (1Click, measured Oct 21). */
  extra?: number;
  /** How to send it, when the wallet isn't an ordinary one. */
  how?: string;
  /** Said under the address when the send itself is public. */
  note?: string;
}

export const USDC_NEAR = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

export const ASSETS: ReserveAsset[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    chain: 'Bitcoin',
    source: 'nep141:btc.omft.near',
    reserve: 'nep141:btc.omft.near',
    digits: 5,
    wait: 'BTC deposits need 1 confirmation, usually 10 minutes.',
    demoPrice: 80_500,
  },
  {
    symbol: 'ETH',
    name: 'Ether',
    chain: 'Ethereum',
    source: 'nep141:eth.omft.near',
    reserve: 'nep141:eth.omft.near',
    digits: 4,
    wait: 'ETH deposits usually arrive in a few minutes.',
    demoPrice: 2_430,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    chain: 'Solana',
    source: 'nep141:sol.omft.near',
    reserve: 'nep141:sol.omft.near',
    digits: 2,
    wait: 'SOL deposits usually arrive in under a minute.',
    demoPrice: 96,
  },
  {
    symbol: 'NEAR',
    name: 'NEAR',
    chain: 'NEAR',
    source: 'nep141:wrap.near',
    reserve: 'nep141:wrap.near',
    digits: 1,
    wait: 'NEAR deposits usually arrive in under a minute.',
    demoPrice: 4.05,
  },
  {
    symbol: 'USDC',
    name: 'USDC',
    chain: 'Arbitrum',
    source: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    reserve: USDC_NEAR,
    digits: 0,
    wait: 'USDC deposits from Arbitrum usually arrive in under a minute.',
    demoPrice: 1,
  },
];

/**
 * A USDC reserve funded from the trader's own Hyperliquid account: the easiest way in, since the money is already
 * there. Hyperliquid's Send moves it to a one-time address and NEAR Intents credits the guard's private balance in
 * about a minute (Oct 21 on mainnet: 5.00 in, 4.80 credited). The send itself shows on Hyperliquid, so funding from
 * another chain stays the private way.
 */
export const FROM_HYPERLIQUID: ReserveAsset = {
  symbol: 'USDC',
  name: 'USDC on Hyperliquid',
  chain: 'Hyperliquid',
  source: '1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054',
  reserve: USDC_NEAR,
  digits: 2,
  wait: 'From Hyperliquid, a reserve usually arrives in about a minute.',
  demoPrice: 1,
  extra: 1,
  how: 'In Hyperliquid, open Portfolio, choose Send, and paste this address.',
  note: 'This send shows on Hyperliquid, so anyone can see its size. To keep the reserve unsized, fund from Arbitrum.',
};

/** Where a reserve can be sent from: USDC also from Hyperliquid itself, offered first. */
export const sourcesFor = (a: ReserveAsset): ReserveAsset[] => (a.reserve === USDC_NEAR ? [FROM_HYPERLIQUID, a] : [a]);

export type Prices = Record<string, number>;

export const demoPrices = (): Prices => Object.fromEntries(ASSETS.map((a) => [a.source, a.demoPrice]));

export function amountText(a: ReserveAsset, usd: number, price: number): string {
  return (usd / price).toLocaleString('en-US', { maximumFractionDigits: a.digits });
}

/** At least this many dollars of the asset, rounded up to the digits shown, so "2×" really is 2×. */
export function suggestAmount(a: ReserveAsset, usd: number, price: number): string {
  const unit = 10 ** a.digits;
  return (Math.ceil((usd / price) * unit) / unit).toFixed(a.digits);
}
