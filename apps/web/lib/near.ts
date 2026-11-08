// Where Ripcord's NEAR pieces live, for the links that prove them. Testnet until the mainnet deploy (Day 8): the
// registry contract, the enclave project, and two transactions from the end-to-end runs (docs/EVIDENCE.md).
export const NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK ?? 'testnet';
export const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY ?? 'ripcord-registry-db06d339.testnet';
export const EXPLORER = NETWORK === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';

/** The checker's OutLayer project, and the sha256 of the build it runs (what `checker/build.sh` prints). */
export const CHECKER_PROJECT = 'ripcord-ops-57834db8.testnet/checker';
export const CHECKER_HASH = 'a3e25275a2b56e4fb418a545201311d4f180d07ac477b42673a728c800d36298';

/** The enclave registering a guard (hashes only), and an owner freezing a guard's reserve with one signature. */
export const REGISTER_TX = '8Mmt6DwnhkfoZsRqqUqrjn7sDgEhJCSmGE5aCZKcqkPo';
export const FREEZE_TX = 'J6N1R7VZhyZzJoS5fgn4WJ48XqkrQ2He1oFB1nV1qLi9';

export const accountUrl = (account: string) => `${EXPLORER}/address/${account}`;
export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;

const REPO = 'https://github.com/Musaga-Technology/Ripcord';
export const codeUrl = (path: string) => `${REPO}/blob/main/${path}`;

export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
