// The poker's HTTP API (docs/SPEC.md §4). Registering an address proves knowledge of the guard's account salt:
// sha256(lowercase(hl_address) ‖ account_salt) must equal the registry's public account commitment, and only the
// owner's device holds the salt. Responses and logs never carry an address.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { accountCommitment, isGuardId } from '@ripcord/shared';
import type { Store } from './store';
import type { Watcher } from './watch';

export type CommitmentOf = (guardId: string) => Promise<string | null>;

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('too large');
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function send(res: ServerResponse, code: number, v: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(v));
}

export function server(watcher: Watcher, store: Store, commitmentOf: CommitmentOf, now = Date.now): Server {
  const proves = async (guardId: string, b: Record<string, unknown>): Promise<string | null> => {
    const { hl_address: hl, account_salt: salt } = b;
    if (typeof hl !== 'string' || typeof salt !== 'string') return null;
    let mine: string;
    try {
      mine = accountCommitment(hl, salt);
    } catch {
      return null;
    }
    return (await commitmentOf(guardId)) === mine ? hl : null;
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://poker');
      const [, v1, kind, id] = url.pathname.split('/');
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, guards: watcher.list().length });
      if (v1 !== 'v1' || !id || !isGuardId(id)) return send(res, 404, { error: 'not found' });

      if (kind === 'health' && req.method === 'GET') {
        const h = watcher.health(id, now());
        return h ? send(res, 200, h) : send(res, 404, { error: 'not watched' });
      }
      if (kind === 'watch' && (req.method === 'PUT' || req.method === 'DELETE')) {
        const hl = await proves(id, await body(req));
        if (!hl) return send(res, 403, { error: 'the address and salt do not match this guard' });
        if (req.method === 'PUT') watcher.add({ guardId: id, hlAddress: hl });
        else watcher.remove(id);
        store.save(watcher.list());
        return send(res, 200, { watching: req.method === 'PUT' });
      }
      return send(res, 404, { error: 'not found' });
    } catch {
      return send(res, 400, { error: 'bad request' });
    }
  });
}
