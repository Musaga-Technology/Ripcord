import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { accountCommitment } from '@ripcord/shared';
import { server } from '../src/server';
import { Store } from '../src/store';
import { Watcher } from '../src/watch';

const GID = 'g-vf6per4bfx';
const HL = '0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3';
const SALT = '7a008a939e32fc26d75bc749937a97e7b43ad2bf18ebd87b51b0e2e2d84b9e44';
const KEY = 'a test key that is long enough to use';

const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'poker-'));
  const store = new Store(join(dir, 'watch.json'), KEY);
  const watcher = new Watcher({ state: async () => [], mids: async () => ({}) }, async () => 'guarding');
  const s = server(
    watcher,
    store,
    async (id) => (id === GID ? accountCommitment(HL, SALT) : null),
    () => 0,
  );
  await new Promise<void>((ok) => s.listen(0, ok));
  open.push(s);
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const req = (method: string, path: string, body?: object) =>
    fetch(base + path, { method, body: body ? JSON.stringify(body) : null }).then(async (r) => [
      r.status,
      await r.json(),
    ]);
  return { req, watcher, store, file: join(dir, 'watch.json') };
}

describe('the poker API', () => {
  it('watches an address only with the salt that matches the public commitment', async () => {
    const { req, watcher } = await start();
    expect(await req('PUT', `/v1/watch/${GID}`, { hl_address: HL, account_salt: '00'.repeat(32) })).toEqual([
      403,
      { error: 'the address and salt do not match this guard' },
    ]);
    expect(watcher.list()).toEqual([]);
    expect(await req('PUT', `/v1/watch/${GID}`, { hl_address: HL, account_salt: SALT })).toEqual([
      200,
      { watching: true },
    ]);
    expect(watcher.list()).toEqual([{ guardId: GID, hlAddress: HL }]);
  });

  it('keeps the watch list encrypted at rest', async () => {
    const { req, store, file } = await start();
    await req('PUT', `/v1/watch/${GID}`, { hl_address: HL, account_salt: SALT });
    expect(readFileSync(file, 'utf8').toLowerCase()).not.toContain(HL.slice(2).toLowerCase());
    expect(store.load()).toEqual([{ guardId: GID, hlAddress: HL }]);
    expect(() => new Store(file, 'another key that is long enough!!').load()).toThrow();
  });

  it('stops watching only with the same proof', async () => {
    const { req, watcher } = await start();
    await req('PUT', `/v1/watch/${GID}`, { hl_address: HL, account_salt: SALT });
    expect((await req('DELETE', `/v1/watch/${GID}`, {}))[0]).toBe(403);
    expect(watcher.list()).toHaveLength(1);
    expect(await req('DELETE', `/v1/watch/${GID}`, { hl_address: HL, account_salt: SALT })).toEqual([
      200,
      { watching: false },
    ]);
    expect(watcher.list()).toEqual([]);
  });

  it('answers health with times and counts, never an address', async () => {
    const { req } = await start();
    await req('PUT', `/v1/watch/${GID}`, { hl_address: HL, account_salt: SALT });
    const [code, h] = await req('GET', `/v1/health/${GID}`);
    expect([code, h]).toEqual([200, { last_check_at: null, checks_24h: 0 }]);
    expect((await req('GET', '/v1/health/g-aaaaaaaaaa'))[0]).toBe(404);
    expect((await req('GET', '/v1/health/not-a-guard'))[0]).toBe(404);
  });
});
