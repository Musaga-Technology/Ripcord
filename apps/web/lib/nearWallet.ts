// A NEAR wallet as a guard's owner, through NEAR Connect (HOT, Meteor, Intear, MyNearWallet and others). It signs the
// owner's actions as NEP-413 messages for the registry: the same bytes the seal file's key signs, so the registry and
// the enclave check them unchanged. Ed25519 signs a message the same way every time, so the wallet re-creates the
// owner's salt on any device, and with it finds and freezes its guards with no seal file at all.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { fromBase58, nep413Hash, ownerSalt } from '@ripcord/shared';
import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import { NETWORK, REGISTRY } from './near';

/** What the owner's salt is made from: this message, signed with this nonce, for the registry. */
const SALT_MESSAGE = 'ripcord:owner-salt:v1';
const SALT_NONCE = 'owner-salt';
/** A guard action may take a while to reach the chain. */
const GAS = '50000000000000';

export interface NearOwner {
  account: string;
  /** `ed25519:<base58>`: the key the wallet signs with, which the guard's settings name as its owner. */
  key: string;
  salt: string;
}

let connector: Promise<NearConnector> | null = null;
const getConnector = () =>
  (connector ??= import('@hot-labs/near-connect').then(
    ({ NearConnector }) => new NearConnector({ network: NETWORK, features: { signMessage: true } }),
  ));

async function wallet(): Promise<NearWalletBase> {
  const c = await getConnector();
  try {
    return (await c.getConnectedWallet()).wallet;
  } catch {
    return c.connect();
  }
}

/** A wallet's signature as bytes: wallets answer in base64 (NEP-413), some in `ed25519:<base58>` or hex. */
function signatureBytes(sig: string): Uint8Array | null {
  try {
    if (sig.startsWith('ed25519:')) return fromBase58(sig.slice('ed25519:'.length));
    if (/^(0x)?[0-9a-f]{128}$/i.test(sig)) return hexToBytes(sig.replace(/^0x/, ''));
    return Uint8Array.from(atob(sig), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The signature, as hex, if it is `key`'s NEP-413 signature of `message` for the registry; otherwise null. Checked
 * here so a wallet that signs something else fails on this device, not on chain.
 */
export function checkedSignature(key: string, message: string, nonce: string, signature: string): string | null {
  const sig = signatureBytes(signature);
  if (!sig || sig.length !== 64 || !key.startsWith('ed25519:')) return null;
  try {
    const pk = fromBase58(key.slice('ed25519:'.length));
    return ed25519.verify(sig, nep413Hash(message, nonce, REGISTRY), pk) ? bytesToHex(sig) : null;
  } catch {
    return null;
  }
}

async function sign(w: NearWalletBase, message: string, nonce: string, key?: string) {
  const s = await w.signMessage({ message, recipient: REGISTRY, nonce: sha256(utf8ToBytes(nonce)), network: NETWORK });
  if (key && s.publicKey !== key)
    throw new Error(`this guard's owner is another NEAR key; connect the wallet that set it up`);
  const hex = checkedSignature(s.publicKey, message, nonce, s.signature);
  if (!hex) throw new Error("the wallet's signature doesn't check out for the registry");
  return { hex, account: s.accountId, key: s.publicKey };
}

/** Connects a NEAR wallet and has it sign the salt message: the owner it gives is the same on every device. */
export async function connectNearOwner(): Promise<NearOwner> {
  const s = await sign(await wallet(), SALT_MESSAGE, SALT_NONCE);
  return { account: s.account, key: s.key, salt: ownerSalt(s.hex) };
}

/** Signs one owner action with the guard's NEAR wallet, which must hold `key`. */
export async function nearSign(key: string, message: string, nonce: string): Promise<string> {
  return (await sign(await wallet(), message, nonce, key)).hex;
}

/** Sends `freeze_guard` or `unfreeze_guard` from the owner's own wallet, straight to the registry: nothing of
 * Ripcord's is involved, so it works even if Ripcord is gone. The owner pays the gas. */
export async function freezeFromWallet(
  owner: NearOwner,
  guardId: string,
  frozen: boolean,
  message: string,
  nonce: string,
): Promise<string> {
  const w = await wallet();
  const sig = await nearSign(owner.key, message, nonce);
  const out = await w.signAndSendTransaction({
    network: NETWORK,
    receiverId: REGISTRY,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: frozen ? 'freeze_guard' : 'unfreeze_guard',
          args: { guard_id: guardId, owner: owner.key, owner_salt: owner.salt, sig, nonce },
          gas: GAS,
          deposit: '0',
        },
      },
    ],
  });
  return out.transaction.hash;
}
