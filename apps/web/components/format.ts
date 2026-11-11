const group = (n: number, digits: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Prices close to how Hyperliquid shows them: whole numbers from 10,000 up, 2 decimals from 1, and below 1 up to 5
 * significant digits (at most 6 decimals), so a sub-cent coin doesn't read as 0.00. */
export function price(n: number): string {
  if (n >= 10_000) return group(n, 0);
  if (n >= 1 || n <= 0) return group(n, 2);
  const max = Math.min(6, Math.max(2, 4 - Math.floor(Math.log10(n))));
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: max });
}
export const usd = (n: number, digits = 0) => '$' + group(n, digits);
export const pct = (n: number) => n.toFixed(1) + '%';
