// The watch list at rest: AES-256-GCM under a key from the environment, so a copied disk shows no address.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Guard } from './watch';

export class Store {
  private key: Buffer;

  constructor(
    private path: string,
    secret: string,
  ) {
    if (secret.length < 32) throw new Error('POKER_STORE_KEY must be at least 32 characters');
    this.key = createHash('sha256').update(secret).digest();
  }

  load(): Guard[] {
    if (!existsSync(this.path)) return [];
    const { iv, tag, ct } = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>;
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv!, 'base64'));
    d.setAuthTag(Buffer.from(tag!, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(ct!, 'base64')), d.final()]);
    return JSON.parse(plain.toString('utf8')) as Guard[];
  }

  save(guards: Guard[]): void {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(guards), 'utf8'), c.final()]);
    const body = { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
    writeFileSync(`${this.path}.tmp`, JSON.stringify(body), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
