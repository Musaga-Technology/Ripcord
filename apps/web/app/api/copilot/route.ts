import { NextResponse, type NextRequest } from 'next/server';

// Relays the plain-words set-up to NEAR AI Cloud with Ripcord's API key, which must stay on the server. Messages arrive
// encrypted to the model's enclave and the answer goes back encrypted to the browser's key, so this route never sees
// either. Nothing is logged.
const API = 'https://cloud-api.near.ai/v1';
const MODEL = process.env.NEARAI_MODEL || 'Qwen/Qwen3.8-27B';
const HEX = /^[0-9a-f]+$/;
const KEY64 = /^[0-9a-f]{64}$/;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

const seen = new Map<string, { at: number; n: number }>();
function tooMany(req: NextRequest): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const e = seen.get(ip);
  if (!e || now - e.at > WINDOW_MS) {
    if (seen.size > 10_000) seen.clear();
    seen.set(ip, { at: now, n: 1 });
    return false;
  }
  return ++e.n > MAX_PER_WINDOW;
}

const key = () => process.env.NEARAI_API_KEY;

/** The model's attestation for this request's nonce: the key the browser encrypts to. */
export async function GET(req: NextRequest) {
  const nonce = req.nextUrl.searchParams.get('nonce') ?? '';
  if (!key()) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!KEY64.test(nonce)) return NextResponse.json({ error: 'bad nonce' }, { status: 400 });
  const q = new URLSearchParams({
    model: MODEL,
    provider: 'near',
    signing_algo: 'ed25519',
    include_tls_fingerprint: 'false',
    nonce,
  });
  try {
    const r = await fetch(`${API}/attestation/report?${q}`, {
      headers: { Authorization: `Bearer ${key()}`, 'x-no-aliasing': 'true' },
      signal: AbortSignal.timeout(20_000),
    });
    const a = (await r.json()) as { model_attestations?: Record<string, unknown>[] };
    const m = a.model_attestations?.[0];
    if (!r.ok || !m) return NextResponse.json({ error: 'no attestation' }, { status: 502 });
    return NextResponse.json({
      model: MODEL,
      signing_public_key: m.signing_public_key,
      signing_address: m.signing_address,
      request_nonce: m.request_nonce,
    });
  } catch {
    return NextResponse.json({ error: 'no attestation' }, { status: 502 });
  }
}

/** One encrypted chat completion; answers with the encrypted content only. */
export async function POST(req: NextRequest) {
  if (!key()) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (tooMany(req)) return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  const text = await req.text();
  if (text.length > 16_384) return NextResponse.json({ error: 'too large' }, { status: 413 });
  let b: { model_pub?: unknown; client_pub?: unknown; messages?: { role?: unknown; content?: unknown }[] };
  try {
    b = JSON.parse(text) as typeof b;
  } catch {
    return NextResponse.json({ error: 'not JSON' }, { status: 400 });
  }
  const messages = Array.isArray(b.messages) ? b.messages.slice(0, 2) : [];
  const ok =
    typeof b.model_pub === 'string' &&
    KEY64.test(b.model_pub) &&
    typeof b.client_pub === 'string' &&
    KEY64.test(b.client_pub) &&
    messages.length === 2 &&
    messages.every(
      (m) => (m.role === 'system' || m.role === 'user') && typeof m.content === 'string' && HEX.test(m.content),
    );
  if (!ok) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  try {
    const r = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key()}`,
        'Content-Type': 'application/json',
        'X-Signing-Algo': 'ed25519',
        'X-Client-Pub-Key': b.client_pub as string,
        'X-Model-Pub-Key': b.model_pub as string,
        'X-Encryption-Version': '2',
        'x-no-aliasing': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        max_tokens: 300,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const a = (await r.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = a.choices?.[0]?.message?.content;
    if (!r.ok || typeof content !== 'string' || !HEX.test(content))
      return NextResponse.json({ error: 'no answer' }, { status: 502 });
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: 'no answer' }, { status: 502 });
  }
}
