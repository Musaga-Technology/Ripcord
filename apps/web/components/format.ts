const group = (n: number, digits: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Prices as Hyperliquid shows them: whole numbers from 10,000 up, otherwise 2 decimals. */
export const price = (n: number) => group(n, n >= 10_000 ? 0 : 2);
export const usd = (n: number, digits = 0) => '$' + group(n, digits);
export const pct = (n: number) => n.toFixed(1) + '%';
