// The open keeper network, as the simulation shows it: independent keepers each ask the enclave to check a guard on
// their own rhythm, and the one whose check fires a rescue is credited a bounty on the keeper market. Which keeper
// wins is drawn from the run, so a replay of the same crash credits the same keeper.

/** The keeper market, live on NEAR testnet. */
export const KEEPER_MARKET_URL = 'https://testnet.nearblocks.io/address/ripcord-keepers-e3d46d7d.testnet';
/** The market's bounty per rescue, in NEAR. */
export const KEEPER_BOUNTY = 0.01;

/** Example keepers: anyone can run one under their own NEAR account. */
export const KEEPERS = [
  'nightwatch.near',
  'blindkeeper.near',
  'sentinel-7.near',
  'lantern.near',
  'tidewatch.near',
  'ward.near',
  'owlpost.near',
  'beacon-3.near',
  'harbor.near',
] as const;

/** The keeper whose check fired the rescue that fired at `firedAt` in a run seeded with `seed`. */
export function keeperFor(seed: number, firedAt: number): number {
  // A small integer hash (xorshift), enough to spread wins across keepers deterministically.
  let x = (Math.imul(seed | 0, 2654435761) ^ Math.imul(firedAt | 0, 40503)) >>> 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) % KEEPERS.length;
}
