// The risk desk: Ripcord's worker on NEAR's Agent Market. A person or an agent hires it, or calls it over A2A and
// pays per call; it answers with the liquidation risk report for the Hyperliquid account named in the brief. It
// polls with its own agent token, which can't move funds, and never writes an address to its log.
import { findAddress, readAccount, shortAddress, type Fetch, type Sources } from './read';
import { assess, riskMarkdown } from './risk';

export interface DeskDeps {
  /** The market's API base, e.g. https://market.near.ai */
  market: string;
  /** The desk agent's `aat_` token. */
  token: string;
  sources: Sources;
  appUrl: string | null;
  fetch: Fetch;
  log: (line: string) => void;
  now: () => Date;
}

export interface Row {
  assignment: { assignmentId: string; startedAt: string | null; submittedAt: string | null };
  job: { title: string; description: string };
  latestMessage: { senderSide: string; body: string } | null;
}

export const NO_ADDRESS =
  'Send the Hyperliquid account to check: 0x followed by 40 hex characters. Nothing was charged.';

async function call<T>(d: DeskDeps, method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const res = await d.fetch(`${d.market}${path}`, {
    method,
    headers: { Authorization: `Bearer ${d.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`the market answered ${res.status} to ${path.split('/').slice(0, 3).join('/')}…`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

/** The account to check: one the buyer just wrote (an A2A call or a rework note), else the one in the brief. */
export function addressOf(row: Row): string | null {
  const m = row.latestMessage;
  const fromBuyer = m && m.senderSide === 'buyer' ? findAddress(m.body) : null;
  return fromBuyer ?? findAddress(`${row.job.title}\n${row.job.description}`);
}

/** One pass over the desk's open assignments. */
export async function work(d: DeskDeps) {
  const done = { delivered: 0, declined: 0, failed: 0 };
  const { assignments } = await call<{ assignments: Row[] }>(d, 'GET', '/v1/agents/me/assignments?status=in_progress');
  for (const row of assignments) {
    const id = row.assignment.assignmentId;
    try {
      if (!row.assignment.startedAt) await call(d, 'POST', `/v1/assignments/${id}/start`);
      const address = addressOf(row);
      if (!address) {
        await call(d, 'POST', `/v1/assignments/${id}/decline`, { reason: 'rejected', detail: NO_ADDRESS });
        d.log(`declined ${id}: no address in the brief`);
        done.declined++;
        continue;
      }
      const risk = assess(await readAccount(d.sources, address), d.now());
      const deliverableMarkdown = riskMarkdown(risk, { account: shortAddress(address), appUrl: d.appUrl });
      await call(d, 'POST', `/v1/assignments/${id}/submit`, { deliverableMarkdown });
      d.log(`delivered ${id}: ${risk.positions.length} position${risk.positions.length === 1 ? '' : 's'}`);
      done.delivered++;
    } catch (e) {
      // Left in progress, so the next pass tries again.
      d.log(`failed ${id}: ${e instanceof Error ? e.message : 'unknown error'}`);
      done.failed++;
    }
  }
  return done;
}
