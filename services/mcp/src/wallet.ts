// The demo agent's own wallet on Base: a key made on this machine and kept in a file only its owner can read. It is
// never printed and never sent anywhere. The agent uses it for one thing: paying exactly the deposit Ripcord quoted.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

export interface AgentWallet {
  address: `0x${string}`;
  /** ETH on Base, in wei. */
  balance(): Promise<bigint>;
  /** Sends exactly `wei` of ETH on Base to `to` and waits for it to land; answers the transaction hash. */
  pay(to: `0x${string}`, wei: bigint): Promise<string>;
}

async function keyAt(file: string): Promise<Hex> {
  try {
    return (JSON.parse(await readFile(file, 'utf8')) as { key: Hex }).key;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(`The agent's wallet file can't be read: ${file}`, { cause: e });
    const key = generatePrivateKey();
    // `wx`: never overwrite a wallet that might hold money.
    await writeFile(file, JSON.stringify({ key }), { mode: 0o600, flag: 'wx' });
    return key;
  }
}

export async function agentWallet(home: string, rpc = 'https://mainnet.base.org'): Promise<AgentWallet> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const account = privateKeyToAccount(await keyAt(join(home, 'agent-wallet-base.json')));
  const chain = createPublicClient({ chain: base, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: base, transport: http(rpc) });
  return {
    address: account.address,
    balance: () => chain.getBalance({ address: account.address }),
    async pay(to, wei) {
      const hash = await wallet.sendTransaction({ to, value: wei });
      await chain.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}
