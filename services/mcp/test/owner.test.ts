import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openSealFile } from '@ripcord/shared';
import { createGuard, finishGuard, freezeGuard, fundGuard, sealPath, type OwnerDeps } from '../src/owner';
import { ripcordServer } from '../src/tools';
import { AGENT, fakeChecker, POKER, RELAY } from './checker';
import { ADDRESS, publicApis, SOURCES } from './fixtures';

const PASS = 'correct horse battery staple';

async function setup(passphrase: string | null = PASS) {
  const checker = fakeChecker();
  const hl = publicApis();
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) =>
    (await checker.fetchFn(url, init)) ?? hl(url, init)) as typeof fetch;
  const d: OwnerDeps = {
    sources: { ...SOURCES, fetch: fetchFn },
    relay: RELAY,
    pokers: [POKER],
    home: await mkdtemp(join(tmpdir(), 'ripcord-owner-')),
    passphrase,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: () => Date.parse('2026-11-12T13:50:00Z'),
    scryptN: 2 ** 10,
  };
  return { d, checker };
}

describe("an agent's own guard", () => {
  it('is sealed on this machine: the seal file stays here, locked, and only hashes and an envelope leave', async () => {
    const { d, checker } = await setup();
    const g = await createGuard(d, { address: ADDRESS, coin: 'ETH' });
    expect(g).toMatchObject({ position: 'ETH long', margin: 'cross', approval: null });

    const file = JSON.parse(await readFile(g.file, 'utf8'));
    expect((await stat(g.file)).mode & 0o777).toBe(0o600);
    const { contents } = await openSealFile(file, PASS);
    expect(contents.settings).toMatchObject({ hl_address: ADDRESS, budget_usd: 2990.6, isolated: null });
    expect(contents.owner_secret).toMatch(/^[0-9a-f]{64}$/);
    // The checker opened the same settings and they matched all three public hashes.
    expect(checker.guards.get(g.guardId)!.settings).toEqual(contents.settings);

    const sent = checker.bodies.join('\n').toLowerCase();
    expect(sent).not.toContain(ADDRESS.slice(2));
    expect(sent).not.toContain(PASS);
    expect(sent).not.toContain(contents.owner_secret);
  });

  it("asks for the isolated position's one approval, of a key that can only add margin", async () => {
    const { d } = await setup();
    const g = await createGuard(d, { address: ADDRESS, coin: 'SOL', reserveUsd: 50, preset: 'safer' });
    expect(g.margin).toBe('isolated');
    expect(g.approval?.agent).toBe(AGENT);
    expect(g.approval?.name).toMatch(/^[0-9a-f]{8} valid_until \d{13}$/);
  });

  it('says exactly what to send and where, from Arbitrum or from Hyperliquid with its $1', async () => {
    const { d } = await setup();
    const g = await createGuard(d, { address: ADDRESS, coin: 'ETH', reserveUsd: 25 });
    expect(await fundGuard(d, { guardId: g.guardId, from: 'arbitrum' })).toMatchObject({
      chain: 'Arbitrum',
      amount: '25',
      address: 'deposit-nep141:arb',
    });
    expect(await fundGuard(d, { guardId: g.guardId, from: 'hyperliquid' })).toMatchObject({
      chain: 'Hyperliquid',
      amount: '26.00',
    });
  });

  it('waits for the reserve, then hands the guard to the pokers with the proof only its owner has', async () => {
    const { d, checker } = await setup();
    const g = await createGuard(d, { address: ADDRESS, coin: 'ETH', reserveUsd: 25 });
    expect(await finishGuard(d, { guardId: g.guardId })).toEqual({ state: 'waiting', watchers: 0 });
    expect(checker.watches).toEqual([]);
    checker.funded.add(g.guardId);
    expect(await finishGuard(d, { guardId: g.guardId })).toEqual({ state: 'guarding', watchers: 1 });
    const settings = checker.guards.get(g.guardId)!.settings;
    expect(checker.watches).toEqual([
      { guardId: g.guardId, body: { hl_address: ADDRESS, account_salt: settings.account_salt } },
    ]);
  });

  it("freezes with the seal file's owner key, which the registry's check accepts", async () => {
    const { d, checker } = await setup();
    const g = await createGuard(d, { address: ADDRESS, coin: 'ETH', reserveUsd: 25 });
    await freezeGuard(d, { guardId: g.guardId, frozen: true });
    expect(checker.frozen.get(g.guardId)).toBe(true);
    await freezeGuard(d, { guardId: g.guardId, frozen: false });
    expect(checker.frozen.get(g.guardId)).toBe(false);
  });

  it('needs the operator’s passphrase, opens only with it, and takes only guard ids', async () => {
    const { d } = await setup();
    const g = await createGuard(d, { address: ADDRESS, coin: 'ETH', reserveUsd: 25 });
    await expect(createGuard({ ...d, passphrase: null }, { address: ADDRESS, coin: 'ETH' })).rejects.toThrow(
      'RIPCORD_PASSPHRASE',
    );
    await expect(
      freezeGuard({ ...d, passphrase: 'another long passphrase' }, { guardId: g.guardId, frozen: true }),
    ).rejects.toThrow("doesn't open");
    expect(() => sealPath(d, '../../etc/passwd')).toThrow('not a guard id');
  });

  it('refuses a position that is not open and a reserve under one rescue', async () => {
    const { d } = await setup();
    await expect(createGuard(d, { address: ADDRESS, coin: 'DOGE' })).rejects.toThrow('No open DOGE position');
    await expect(createGuard(d, { address: ADDRESS, coin: 'ETH', reserveUsd: 1 })).rejects.toThrow('at least $2');
  });
});

describe('the owner tools over MCP', () => {
  it('seal, fund and finish a guard without returning its settings', async () => {
    const { d, checker } = await setup();
    const server = ripcordServer({ sources: d.sources, appUrl: 'https://app.test', owner: d });
    const client = new Client({ name: 'agent', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const say = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      return (r.content as { text: string }[]).map((c) => c.text).join('\n');
    };

    const created = await say('create_guard', { address: ADDRESS, coin: 'ETH', reserve_usd: 25 });
    const guardId = /Sealed guard (\S+) /.exec(created)![1]!;
    expect(created).toContain('Next: fund_guard.');
    const s = checker.guards.get(guardId)!.settings;
    for (const secret of [String(s.line_range_pct[0]), String(s.target_range_pct[1]), s.account_salt]) {
      expect(created).not.toContain(secret);
    }
    expect(await say('fund_guard', { guard_id: guardId, from: 'arbitrum' })).toContain(
      'Send exactly 25 USDC on Arbitrum',
    );
    expect(await say('finish_guard', { guard_id: guardId })).toContain('Not yet');
    checker.funded.add(guardId);
    expect(await say('finish_guard', { guard_id: guardId })).toContain('1 poker watch');
    expect(await say('freeze_guard', { guard_id: guardId, frozen: true })).toContain('Frozen');
    expect(await stat(sealPath(d, guardId))).toBeTruthy();
  });
});
