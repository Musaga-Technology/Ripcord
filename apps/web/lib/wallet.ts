// The trader's wallet, through whatever the browser injects (EIP-6963, then window.ethereum). Connecting only gives
// the address: a guard's owner is a key the app makes, so there is nothing to sign in with. A wallet is asked to sign
// two Hyperliquid actions, each shown in full in its own window: an isolated guard's `approveAgent`
// (ARCHITECTURE §4.6), and the `usdSend` that funds a reserve from the trader's own Hyperliquid balance.
import { postExchange } from './hl';

interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (s: string) => ADDRESS.test(s.trim());

function injected(): Promise<Provider | null> {
  return new Promise((resolve) => {
    let found: Provider | null = null;
    const on = (e: Event) => {
      found ??= (e as CustomEvent<{ provider: Provider }>).detail.provider;
    };
    window.addEventListener('eip6963:announceProvider', on);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', on);
      resolve(found ?? (window as unknown as { ethereum?: Provider }).ethereum ?? null);
    }, 120);
  });
}

export const hasWallet = async () => (await injected()) !== null;

export async function connectWallet(): Promise<string | null> {
  const p = await injected();
  if (!p) return null;
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts[0]?.toLowerCase() ?? null;
}

export interface ApproveAgent {
  type: 'approveAgent';
  hyperliquidChain: 'Mainnet';
  signatureChainId: string;
  agentAddress: string;
  agentName: string;
  nonce: number;
}

/** Hyperliquid's user-signed action, as in hyperliquid-python-sdk `sign_agent`. */
export function approveAgentAction(
  agentAddress: string,
  name: string,
  validUntilMs: number,
  chainId: string,
  now: number,
): ApproveAgent {
  return {
    type: 'approveAgent',
    hyperliquidChain: 'Mainnet',
    signatureChainId: chainId,
    agentAddress,
    agentName: `${name} valid_until ${validUntilMs}`,
    nonce: now,
  };
}

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const domainOf = (signatureChainId: string) => ({
  name: 'HyperliquidSignTransaction',
  version: '1',
  chainId: Number.parseInt(signatureChainId, 16),
  verifyingContract: '0x0000000000000000000000000000000000000000',
});

export function approveAgentTypedData(a: ApproveAgent) {
  return {
    domain: domainOf(a.signatureChainId),
    types: {
      'HyperliquidTransaction:ApproveAgent': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'agentAddress', type: 'address' },
        { name: 'agentName', type: 'string' },
        { name: 'nonce', type: 'uint64' },
      ],
      EIP712Domain,
    },
    primaryType: 'HyperliquidTransaction:ApproveAgent',
    message: {
      hyperliquidChain: a.hyperliquidChain,
      agentAddress: a.agentAddress,
      agentName: a.agentName,
      nonce: a.nonce,
    },
  };
}

export interface UsdSend {
  type: 'usdSend';
  hyperliquidChain: 'Mainnet';
  signatureChainId: string;
  destination: string;
  amount: string;
  time: number;
}

/** Hyperliquid's USD send from the perps balance, as in hyperliquid-python-sdk `usd_transfer`. */
export function usdSendAction(destination: string, amount: string, chainId: string, now: number): UsdSend {
  return { type: 'usdSend', hyperliquidChain: 'Mainnet', signatureChainId: chainId, destination, amount, time: now };
}

export function usdSendTypedData(a: UsdSend) {
  return {
    domain: domainOf(a.signatureChainId),
    types: {
      'HyperliquidTransaction:UsdSend': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'destination', type: 'string' },
        { name: 'amount', type: 'string' },
        { name: 'time', type: 'uint64' },
      ],
      EIP712Domain,
    },
    primaryType: 'HyperliquidTransaction:UsdSend',
    message: { hyperliquidChain: a.hyperliquidChain, destination: a.destination, amount: a.amount, time: a.time },
  };
}

/**
 * Has the owner's wallet sign one Hyperliquid action and sends it. The wallet must be the account the guard pays.
 * Wallets refuse typed data for another chain while Hyperliquid accepts any, so the wallet's own chain signs.
 */
async function signAndSend<A extends { type: string }>(
  owner: string,
  build: (chainId: string, now: number) => A,
  typed: (a: A) => object,
  nonceOf: (a: A) => number,
): Promise<string | null> {
  const p = await injected();
  if (!p) return 'No wallet found in this browser.';
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  if (accounts[0]?.toLowerCase() !== owner.toLowerCase())
    return 'Switch your wallet to the account that holds this position.';
  const action = build((await p.request({ method: 'eth_chainId' })) as string, Date.now());
  const sig = (await p.request({
    method: 'eth_signTypedData_v4',
    params: [accounts[0], JSON.stringify(typed(action))],
  })) as string;
  const hex = sig.slice(2);
  const signature = {
    r: `0x${hex.slice(0, 64)}`,
    s: `0x${hex.slice(64, 128)}`,
    v: Number.parseInt(hex.slice(128, 130), 16),
  };
  const answer = await postExchange({
    action,
    nonce: nonceOf(action),
    signature,
    vaultAddress: null,
    expiresAfter: null,
  });
  return answer.status === 'ok' ? null : 'refused';
}

/** Asks the wallet to approve the guard's agent, once, and sends it to Hyperliquid. Returns its answer's error, if any. */
export async function approveAgent(
  owner: string,
  agent: string,
  name: string,
  validUntilMs: number,
): Promise<string | null> {
  const e = await signAndSend(
    owner,
    (chainId, now) => approveAgentAction(agent, name, validUntilMs, chainId, now),
    approveAgentTypedData,
    (a) => a.nonce,
  );
  return e === 'refused' ? "Hyperliquid didn't take the approval. Try again." : e;
}

/** Sends `amount` USDC from the owner's Hyperliquid balance to the reserve's deposit address, signed in the wallet. */
export async function sendFromHyperliquid(owner: string, destination: string, amount: string): Promise<string | null> {
  const e = await signAndSend(
    owner,
    (chainId, now) => usdSendAction(destination, amount, chainId, now),
    usdSendTypedData,
    (a) => a.time,
  );
  return e === 'refused' ? "Hyperliquid didn't take the send. Check your balance and try again." : e;
}
