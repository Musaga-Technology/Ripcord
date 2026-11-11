// Helpers the testnet and mainnet scripts share: sending a call, the ✓/✗ report, and FastFS uploads in the format
// OutLayer's CLI uses (out-layer/outlayer-cli v0.2.1).
import { createHash, randomBytes } from 'node:crypto';
import { actions, type Account } from 'near-api-js';

export const TGAS = 10n ** 12n;
export const NEAR = 10n ** 24n;
export const MILLINEAR = 10n ** 21n;

export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
export const random = (n: number) => new Uint8Array(randomBytes(n));
/** yoctoNEAR as NEAR with 4 decimals, for reports. */
export const near = (yocto: bigint) => (Number(yocto / 10n ** 20n) / 1e4).toFixed(4);

interface Outcome {
  id: string;
  outcome: { gas_burnt?: number | string; status?: { Failure?: unknown; SuccessValue?: string } };
}
export interface TxResult {
  transaction_outcome: Outcome;
  receipts_outcome: Outcome[];
}
export interface Sent {
  ok: boolean;
  tx: string;
  error: string;
  /** Gas burnt by the transaction and all its receipts, in Tgas. */
  tgas: number;
}

/** Signs and sends `actions` from `acc`; a failed receipt is reported, not thrown. */
export async function sendActions(
  acc: Account,
  receiverId: string,
  list: Parameters<Account['signAndSendTransaction']>[0]['actions'],
) {
  try {
    const r = (await acc.signAndSendTransaction({
      receiverId,
      actions: list,
      throwOnFailure: false,
    })) as unknown as TxResult;
    const outcomes = [r.transaction_outcome, ...r.receipts_outcome];
    const failure = outcomes.map((o) => o.outcome.status?.Failure).find(Boolean);
    const tgas = outcomes.reduce((s, o) => s + Number(o.outcome.gas_burnt ?? 0), 0) / 1e12;
    return {
      ok: !failure,
      tx: r.transaction_outcome.id,
      error: failure ? JSON.stringify(failure).slice(0, 300) : '',
      tgas,
    } satisfies Sent;
  } catch (e) {
    return { ok: false, tx: '', error: String((e as Error).message ?? e).slice(0, 300), tgas: 0 } satisfies Sent;
  }
}

/** One function call from `acc`. */
export const send = (
  acc: Account,
  contractId: string,
  method: string,
  args: object | Uint8Array,
  deposit = 0n,
  gas = 100n * TGAS,
) => sendActions(acc, contractId, [actions.functionCall(method, args as never, gas, deposit)]);

let failures = 0;
export function check(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures++;
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}
/** How many checks failed so far: a script exits 1 when any did. */
export const failed = () => failures;

const borshStr = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/**
 * FastFS payloads, as OutLayer's CLI writes them: up to 1 MB, one `Simple` (borsh variant 0: relative_path,
 * Some({mime_type, content})); larger, 1 MB `Partial` chunks (variant 1: relative_path, offset, full_size, mime_type,
 * content_chunk, nonce). Each is recorded by a call that reverts by design.
 */
export function fastfsPayloads(path: string, mime: string, content: Uint8Array): Uint8Array[] {
  const CHUNK = 1 << 20;
  if (content.length <= CHUNK) {
    const body = [Buffer.from([0]), borshStr(path), Buffer.from([1]), borshStr(mime), u32(content.length), content];
    return [new Uint8Array(Buffer.concat(body))];
  }
  const nonce = Math.floor(Date.now() / 1000) - 1_769_376_240;
  const out: Uint8Array[] = [];
  for (let off = 0; off < content.length; off += CHUNK) {
    const chunk = content.subarray(off, off + CHUNK);
    const body = [
      Buffer.from([1]),
      borshStr(path),
      u32(off),
      u32(content.length),
      borshStr(mime),
      u32(chunk.length),
      chunk,
      u32(nonce),
    ];
    out.push(new Uint8Array(Buffer.concat(body)));
  }
  return out;
}

/** Uploads `wasm` to FastFS through `receiver`; true when every chunk reached the chain. */
export async function upload(
  acc: Account,
  receiver: string,
  hash: string,
  wasm: Uint8Array,
  where: string,
): Promise<boolean> {
  const parts = fastfsPayloads(`${hash}.wasm`, 'application/wasm', wasm);
  let ok = true;
  for (const [i, p] of parts.entries()) {
    const up = await send(acc, receiver, '__fastdata_fastfs', p, 0n, 1n);
    const label = parts.length > 1 ? ` (chunk ${i + 1}/${parts.length})` : '';
    check(
      `uploaded ${wasm.length.toLocaleString()} bytes to ${where}${label} (the call reverts by design)`,
      !!up.tx,
      up.tx || up.error,
    );
    ok &&= !!up.tx;
  }
  return ok;
}

/** True once `url` serves bytes whose sha256 is `hash` (FastFS indexes an upload within about a minute). */
export async function serves(url: string, hash: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url).catch(() => null);
    if (
      r?.ok &&
      createHash('sha256')
        .update(new Uint8Array(await r.arrayBuffer()))
        .digest('hex') === hash
    )
      return true;
    if (i + 1 < tries) await new Promise((ok) => setTimeout(ok, 3000));
  }
  return false;
}
