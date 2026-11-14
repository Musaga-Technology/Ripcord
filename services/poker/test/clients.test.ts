import { describe, expect, it } from 'vitest';
import { checker } from '../src/clients';

/** What the poker asks OutLayer to run, and a checker that answers a status. */
function capture() {
  const bodies: { input: Record<string, unknown> }[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as { input: Record<string, unknown> });
    return Response.json({ status: 'completed', output: { status: 'guarding' } });
  }) as typeof fetch;
  return { bodies, fetchFn };
}

const config = { api: 'https://outlayer.test', project: 'ripcord.near/checker', paymentKey: 'owner:1:secret' };

describe('a check call', () => {
  it('names this poker as its keeper when KEEPER_ACCOUNT is set', async () => {
    const { bodies, fetchFn } = capture();
    expect(await checker({ ...config, keeper: 'alice.near' }, fetchFn)('g-vf6per4bfx')).toBe('guarding');
    expect(bodies[0]!.input).toEqual({ action: 'check', guard_id: 'g-vf6per4bfx', keeper: 'alice.near' });
  });

  it('names no keeper otherwise', async () => {
    const { bodies, fetchFn } = capture();
    await checker(config, fetchFn)('g-vf6per4bfx');
    await checker({ ...config, keeper: undefined }, fetchFn)('g-vf6per4bfx');
    for (const b of bodies) expect(b.input).toEqual({ action: 'check', guard_id: 'g-vf6per4bfx' });
  });
});
