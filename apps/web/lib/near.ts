// Where Ripcord's NEAR pieces live on each network, for the reads and the links that prove them (docs/EVIDENCE.md).
// NEXT_PUBLIC_NEAR_NETWORK picks the network; NEXT_PUBLIC_REGISTRY and NEXT_PUBLIC_NEAR_RPC override its defaults.
export const NETWORK: 'mainnet' | 'testnet' =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

const NETS = {
  mainnet: {
    registry: 'ripcord-registry.near',
    outlayer: 'outlayer.near',
    rpc: 'https://free.rpc.fastnear.com',
    explorer: 'https://nearblocks.io',
    // The checker's OutLayer project, and the sha256 of the build it runs (`bash checker/build.sh mainnet`).
    checkerProject: 'ripcord-registry.near/checker',
    checkerHash: '0b22eb19d1b8f4f6ad2565c9847afcbedf821b662f8293c9be8bfca595a9f1b1',
    // Guards whose owners publish every rescue in full on the ledger: Ripcord's own.
    publishedGuards: [] as string[],
  },
  testnet: {
    registry: 'ripcord-registry-db06d339.testnet',
    outlayer: 'outlayer.testnet',
    rpc: 'https://rpc.testnet.near.org',
    explorer: 'https://testnet.nearblocks.io',
    checkerProject: 'ripcord-ops-57834db8.testnet/checker',
    checkerHash: 'fbf779407d7927d702e5788c2a995c8457569420116176f6cd5dcaefe79232c6',
    publishedGuards: [] as string[],
  },
} as const;
const NET = NETS[NETWORK];

export const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY || NET.registry;
export const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC || NET.rpc;
export const OUTLAYER = NET.outlayer;
export const EXPLORER = NET.explorer;
export const CHECKER_PROJECT = NET.checkerProject;
export const CHECKER_HASH = NET.checkerHash;
export const PUBLISHED_GUARDS: readonly string[] = NET.publishedGuards;
export const NETWORK_NAME = NETWORK === 'mainnet' ? 'NEAR' : 'NEAR testnet';

export const accountUrl = (account: string) => `${EXPLORER}/address/${account}`;
export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;

/** The enclave registering a guard (hashes only), and an owner freezing a guard's reserve with one signature (testnet). */
export const REGISTER_TX_URL = `${NETS.testnet.explorer}/txns/8Mmt6DwnhkfoZsRqqUqrjn7sDgEhJCSmGE5aCZKcqkPo`;
export const FREEZE_TX_URL = `${NETS.testnet.explorer}/txns/J6N1R7VZhyZzJoS5fgn4WJ48XqkrQ2He1oFB1nV1qLi9`;

const REPO = 'https://github.com/Musaga-Technology/Ripcord';
export const codeUrl = (path: string) => `${REPO}/blob/main/${path}`;

export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
