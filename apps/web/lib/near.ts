// Ripcord's NEAR accounts per network: mainnet unless NEXT_PUBLIC_NEAR_NETWORK=testnet. NEXT_PUBLIC_REGISTRY and
// NEXT_PUBLIC_NEAR_RPC override the network's defaults.
export const NETWORK: 'mainnet' | 'testnet' =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === 'testnet' ? 'testnet' : 'mainnet';

const NETS = {
  mainnet: {
    registry: 'ripcord-registry.near',
    outlayer: 'outlayer.near',
    rpc: 'https://free.rpc.fastnear.com',
    explorer: 'https://nearblocks.io',
    // The checker's OutLayer project, and the sha256 of the build it runs (`bash checker/build.sh mainnet`).
    checkerProject: 'ripcord-registry.near/checker',
    checkerHash: 'd986122ba7c41cf52128ead2ec1243e62c86de099fb2017000773c48451766bd',
    // Guards whose owners publish every rescue in full on the ledger: Ripcord's own.
    publishedGuards: [] as string[],
  },
  testnet: {
    registry: 'ripcord-registry-db06d339.testnet',
    outlayer: 'outlayer.testnet',
    rpc: 'https://rpc.testnet.near.org',
    explorer: 'https://testnet.nearblocks.io',
    checkerProject: 'ripcord-ops-57834db8.testnet/checker',
    checkerHash: '187b8b5e52b40aaaff49130a1f5da11f0ee25fab676959bb6964eb2fe0a17533',
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
