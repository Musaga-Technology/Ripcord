import { describe, expect, it } from 'vitest';
import { addressOf, NO_ADDRESS, work, type Row } from '../src/desk';
import { ADDRESS, publicApis, SOURCES } from './fixtures';

const OTHER = '0xabcdef0000000000000000000000000000001234';

function row(id: string, o: Partial<{ started: boolean; brief: string; message: string | null }> = {}): Row {
  return {
    assignment: { assignmentId: id, startedAt: o.started ? '2026-11-12T13:00:00Z' : null, submittedAt: null },
    job: { title: 'Liquidation risk report', description: o.brief ?? '' },
    latestMessage: o.message ? { senderSide: 'buyer', body: o.message } : null,
  };
}

/** The market, answering the desk's calls; every call and body is recorded. */
function market(rows: Row[]) {
  const calls: { method: string; path: string; body?: Record<string, unknown>; auth: string | null }[] = [];
  const hl = publicApis();
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.host !== 'market.test') return hl(url, init);
    calls.push({
      method: init?.method ?? 'GET',
      path: u.pathname + u.search,
      ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
      auth: new Headers(init?.headers).get('Authorization'),
    });
    if (u.pathname === '/v1/agents/me/assignments') return Response.json({ assignments: rows });
    return Response.json({ ok: true });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function desk(rows: Row[]) {
  const m = market(rows);
  const log: string[] = [];
  const deps = {
    market: 'https://market.test',
    token: 'aat_test',
    sources: { ...SOURCES, fetch: m.fetchFn },
    appUrl: 'https://app.test',
    fetch: m.fetchFn,
    log: (l: string) => log.push(l),
    now: () => new Date('2026-11-12T13:50:00Z'),
  };
  return { deps, calls: m.calls, log };
}

describe('the risk desk', () => {
  it('starts an A2A call, reads the account in its message and delivers the report', async () => {
    const d = desk([row('a1', { message: `What's my risk? ${ADDRESS}` })]);
    expect(await work(d.deps)).toEqual({ delivered: 1, declined: 0, failed: 0 });
    expect(d.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/agents/me/assignments?status=in_progress',
      'POST /v1/assignments/a1/start',
      'POST /v1/assignments/a1/submit',
    ]);
    expect(d.calls.every((c) => c.auth === 'Bearer aat_test')).toBe(true);
    const md = String(d.calls[2]!.body!.deliverableMarkdown);
    expect(md).toContain('# Liquidation risk for 0x15a6…9fe3');
    expect(md).toContain('**Nearest: ETH long, 17.3% from liquidation.**');
  });

  it('declines a brief with no address, so the buyer is refunded', async () => {
    const d = desk([row('a2', { brief: 'check my positions' })]);
    expect(await work(d.deps)).toEqual({ delivered: 0, declined: 1, failed: 0 });
    expect(d.calls[2]).toMatchObject({
      path: '/v1/assignments/a2/decline',
      body: { reason: 'rejected', detail: NO_ADDRESS },
    });
  });

  it('reworks a returned report for the account the buyer names now, without starting again', async () => {
    const d = desk([row('a3', { started: true, brief: ADDRESS, message: `Wrong account, use ${OTHER}` })]);
    await work(d.deps);
    expect(d.calls.map((c) => c.path)).not.toContain('/v1/assignments/a3/start');
    expect(String(d.calls[1]!.body!.deliverableMarkdown)).toContain('0xabcd…1234');
  });

  it('never writes an address to its log', async () => {
    const d = desk([row('a4', { brief: ADDRESS }), row('a5', { message: OTHER }), row('a6')]);
    await work(d.deps);
    expect(d.log).toEqual([
      'delivered a4: 3 positions',
      'delivered a5: 3 positions',
      'declined a6: no address in the brief',
    ]);
    for (const a of [ADDRESS, OTHER]) {
      expect(d.log.join('\n')).not.toContain(a.slice(2, 8));
    }
  });

  it('leaves an assignment in progress when Hyperliquid fails, to try again next pass', async () => {
    const d = desk([row('a7', { brief: ADDRESS })]);
    d.deps.sources.fetch = (async () => new Response('busy', { status: 503 })) as typeof fetch;
    expect(await work(d.deps)).toEqual({ delivered: 0, declined: 0, failed: 1 });
    expect(d.log).toEqual(['failed a7: Hyperliquid answered 503.']);
    expect(d.calls.map((c) => c.path)).not.toContain('/v1/assignments/a7/submit');
  });

  it('prefers the address the buyer just wrote over the one in the brief', () => {
    expect(addressOf(row('x', { brief: ADDRESS, message: OTHER }))).toBe(OTHER);
    expect(addressOf(row('x', { brief: ADDRESS }))).toBe(ADDRESS);
  });
});
