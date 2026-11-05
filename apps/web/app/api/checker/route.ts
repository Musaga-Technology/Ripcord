import { NextResponse, type NextRequest } from 'next/server';

// Carries a browser's sealed requests to the checker with Ripcord's payment key, which must stay on the server.
// It only ever sees hashes and ciphertext: settings are sealed before they leave the device, and answers are sealed
// to the owner. `check` isn't here, since only pokers ask for checks. Nothing is logged.
const ALLOWED = new Set(['pubkey', 'create', 'fund', 'reserve']);
const MAX_BODY = 8192;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

const seen = new Map<string, { at: number; n: number }>();

function tooMany(ip: string, now: number): boolean {
  const e = seen.get(ip);
  if (!e || now - e.at > WINDOW_MS) {
    if (seen.size > 10_000) seen.clear();
    seen.set(ip, { at: now, n: 1 });
    return false;
  }
  e.n += 1;
  return e.n > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  const api = process.env.OUTLAYER_API_BASE;
  const project = process.env.CHECKER_PROJECT;
  const key = process.env.OUTLAYER_PAYMENT_KEY;
  if (!api || !project || !key) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (tooMany(ip, Date.now())) return NextResponse.json({ error: 'too many requests' }, { status: 429 });

  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'too large' }, { status: 413 });
  let input: { action?: unknown };
  try {
    input = JSON.parse(text) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: 'not JSON' }, { status: 400 });
  }
  if (typeof input.action !== 'string' || !ALLOWED.has(input.action)) {
    return NextResponse.json({ error: 'not allowed' }, { status: 403 });
  }

  try {
    const r = await fetch(`${api}/call/${project}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Payment-Key': key },
      body: JSON.stringify({ input, async: false }),
      signal: AbortSignal.timeout(90_000),
    });
    const answer = (await r.json()) as { status?: string; output?: unknown };
    if (!r.ok || answer.status !== 'completed') return NextResponse.json({ error: 'the guard did not answer' }, { status: 502 });
    const out = typeof answer.output === 'string' ? (JSON.parse(answer.output) as unknown) : answer.output;
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: 'the guard did not answer' }, { status: 502 });
  }
}
