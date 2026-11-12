import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ripcordServer } from '../src/tools';
import { ADDRESS, publicApis, SOURCES } from './fixtures';

async function connect(seen: string[] = []) {
  const server = ripcordServer({
    sources: { ...SOURCES, fetch: publicApis(seen) },
    appUrl: 'https://app.test',
    now: () => new Date('2026-11-12T13:50:00Z'),
  });
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join('\n');

describe('the MCP server', () => {
  it('offers four tools that read and four that act for an agent on its own guard', async () => {
    const { tools } = await (await connect()).listTools();
    const readOnly = (n: string) => tools.find((t) => t.name === n)!.annotations?.readOnlyHint;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_guard',
      'finish_guard',
      'freeze_guard',
      'fund_guard',
      'guard_status',
      'liquidation_risk',
      'replay_odds',
      'ripcord_ledger',
    ]);
    expect(['liquidation_risk', 'replay_odds', 'guard_status', 'ripcord_ledger'].every(readOnly)).toBe(true);
    expect(['create_guard', 'fund_guard', 'finish_guard', 'freeze_guard'].some(readOnly)).toBe(false);
  });

  it('acts on a guard only when the server has an owner side', async () => {
    const r = await (await connect()).callTool({ name: 'finish_guard', arguments: { guard_id: 'g1' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('without an owner side');
  });

  it('reports liquidation risk from public Hyperliquid data', async () => {
    const seen: string[] = [];
    const r = await (await connect(seen)).callTool({ name: 'liquidation_risk', arguments: { address: ADDRESS } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain('**Nearest: ETH long, 17.3% from liquidation.**');
    expect(r.structuredContent).toMatchObject({ accountValue: 28410.55 });
    expect(seen).toEqual(['hl clearinghouseState']);
  });

  it('refuses something that is not a Hyperliquid address, without calling out', async () => {
    const seen: string[] = [];
    const r = await (await connect(seen)).callTool({ name: 'liquidation_risk', arguments: { address: 'vitalik' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('0x followed by 40 hex characters');
    expect(seen).toEqual([]);
  });

  it('quotes replay odds', async () => {
    const r = await (await connect()).callTool({ name: 'replay_odds', arguments: { coin: 'BTC', leverage: 10 } });
    expect(textOf(r)).toContain('14.38% liquidated with no guard; 1.92% with a Ripcord guard');
  });

  it("reads a guard's public record from the registry on NEAR", async () => {
    const seen: string[] = [];
    const r = await (await connect(seen)).callTool({ name: 'guard_status', arguments: { guard_id: 'g-7f3a91c2' } });
    expect(textOf(r)).toContain('Guard g-7f3a91c2 on ripcord-registry.near: guarding');
    expect(textOf(r)).toContain('about $2.1 landed in 38 s, early.');
    expect(seen).toEqual(['near get_guard', 'near get_receipts']);
  });

  it('says when a guard does not exist', async () => {
    const r = await (await connect()).callTool({ name: 'guard_status', arguments: { guard_id: 'nope' } });
    expect(textOf(r)).toBe('No guard nope on ripcord-registry.near.');
  });

  it("counts Ripcord's guards and rescues", async () => {
    const r = await (await connect()).callTool({ name: 'ripcord_ledger', arguments: {} });
    expect(textOf(r)).toBe('ripcord-registry.near: 3 guards, 4 rescues, 1 saves, $9.40 of margin added.');
  });
});
