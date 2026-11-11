// Plain-words set-up, answered by a model inside NEAR AI Cloud's TEE. The request is encrypted in the browser to the
// model's attested key (NEAR AI's E2EE v2: X25519, HKDF-SHA256, XChaCha20-Poly1305), so Ripcord's server only relays
// ciphertext. The model returns intent; the numbers are computed here, and nothing it says can set an address.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Preset } from '@ripcord/shared';
import type { Holding } from './hl';

const INFO = utf8ToBytes('ed25519_encryption');
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** A one-time key for one request: its secret opens the answer, its public half goes in `X-Client-Pub-Key`. */
export function clientKey() {
  const secret = ed25519.utils.randomSecretKey();
  return { secret, pub: bytesToHex(ed25519.getPublicKey(secret)) };
}

/** A fresh attestation nonce, so an old or borrowed report can't be replayed. */
export const freshNonce = () => bytesToHex(rand(32));

/** Encrypts `text` to an Ed25519 public key: [ephemeral X25519 key 32][nonce 24][ciphertext + tag], hex. */
export function sealTo(edPubHex: string, text: string): string {
  const eph = x25519.utils.randomSecretKey();
  const shared = x25519.getSharedSecret(eph, ed25519.utils.toMontgomery(hexToBytes(edPubHex)));
  const nonce = rand(24);
  const ct = xchacha20poly1305(hkdf(sha256, shared, undefined, INFO, 32), nonce).encrypt(utf8ToBytes(text));
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(x25519.getPublicKey(eph), 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return bytesToHex(out);
}

/** Opens what was sealed to the Ed25519 key whose secret is `edSecret`. */
export function openWith(edSecret: Uint8Array, hex: string): string {
  const d = hexToBytes(hex);
  const shared = x25519.getSharedSecret(ed25519.utils.toMontgomerySecret(edSecret), d.subarray(0, 32));
  const key = hkdf(sha256, shared, undefined, INFO, 32);
  return new TextDecoder().decode(xchacha20poly1305(key, d.subarray(32, 56)).decrypt(d.subarray(56)));
}

export type ReserveSymbol = 'BTC' | 'ETH' | 'SOL' | 'NEAR' | 'USDC';
export interface Intent {
  asset: ReserveSymbol | null;
  reserveUsd: number | null;
  surviveDropPct: number | null;
  preset: Preset | null;
  say: string;
}

const SYMBOLS: ReserveSymbol[] = ['BTC', 'ETH', 'SOL', 'NEAR', 'USDC'];
const PRESETS: Preset[] = ['safer', 'balanced', 'lean'];
const num = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/** Reads the model's answer strictly: known fields only, in range, anything else ignored. */
export function parseIntent(text: string): Intent | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sym = typeof v.reserve_asset === 'string' ? v.reserve_asset.toUpperCase() : null;
  const preset = typeof v.preset === 'string' ? v.preset.toLowerCase() : null;
  return {
    asset: SYMBOLS.find((s) => s === sym) ?? null,
    reserveUsd: num(v.reserve_usd, 1, 10_000_000),
    surviveDropPct: num(v.survive_drop_pct, 1, 90),
    preset: PRESETS.find((p) => p === preset) ?? null,
    say: typeof v.say === 'string' ? v.say.slice(0, 140) : '',
  };
}

/**
 * Margin that moves the liquidation price past a `dropPct` move against the position: each dollar of margin moves it
 * by 1 / (size × (1 ∓ maintenance)). Null when Hyperliquid shows no liquidation price.
 */
export function reserveToSurvive(h: Holding, dropPct: number): number | null {
  if (h.liquidation === null || h.size <= 0) return null;
  const mm = 1 / (2 * h.maxLeverage);
  const long = h.side === 'Long';
  const target = h.mark * (long ? 1 - dropPct / 100 : 1 + dropPct / 100);
  const move = long ? h.liquidation - target : target - h.liquidation;
  return Math.max(0, move * h.size * (long ? 1 - mm : 1 + mm));
}

export function instructions(h: Holding): string {
  const liq = h.liquidation === null ? 'none' : String(h.liquidation);
  return [
    `You set up a guard for one Hyperliquid position: ${h.coin} ${h.side.toLowerCase()}, ${h.leverage}x ${h.margin},`,
    `mark ${h.mark}, liquidation ${liq}. The guard keeps a reserve and adds it to the margin before liquidation.`,
    'Turn the trader\'s words into one JSON object and nothing else: {"reserve_asset": "BTC"|"ETH"|"SOL"|"NEAR"|"USDC"|null',
    '(what the reserve is held in, not the position\'s coin), "reserve_usd": number|null (only if they named an amount),',
    '"survive_drop_pct": number|null (a price move they want to survive), "preset": "safer"|"balanced"|"lean"|null',
    '(safer steps in early with more early rescues; lean waits longest with fewer), "say": string (their request',
    'restated in under 15 words)}. Use null for anything they did not say.',
  ].join(' ');
}

export class CopilotError extends Error {}

/** Asks the model, end to end encrypted through Ripcord's relay (`/api/copilot`). */
export async function askCopilot(h: Holding, words: string): Promise<{ intent: Intent; modelKey: string }> {
  const nonce = freshNonce();
  const att = await fetch(`/api/copilot?nonce=${nonce}`).then((r) => (r.ok ? r.json() : null));
  const modelKey: unknown = att?.signing_public_key;
  // The enclave's report must answer this request's own nonce, so an old or borrowed report can't be replayed.
  if (typeof modelKey !== 'string' || !/^[0-9a-f]{64}$/.test(modelKey) || att.request_nonce !== nonce)
    throw new CopilotError("NEAR AI's enclave didn't prove itself.");
  const { secret, pub } = clientKey();
  const r = await fetch('/api/copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_pub: modelKey,
      client_pub: pub,
      messages: [
        { role: 'system', content: sealTo(modelKey, instructions(h)) },
        { role: 'user', content: sealTo(modelKey, words.slice(0, 500)) },
      ],
    }),
  });
  const a = (await r.json().catch(() => null)) as { content?: string } | null;
  if (!r.ok || typeof a?.content !== 'string') throw new CopilotError("NEAR AI didn't answer.");
  const intent = parseIntent(openWith(secret, a.content));
  if (!intent) throw new CopilotError("That didn't read as a guard. Try naming the move to survive or the reserve.");
  return { intent, modelKey };
}
