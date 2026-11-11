// Verify's three checks, run on the owner's device: the seal file matches the guard's fingerprints on NEAR, every
// line the enclave drew is inside the sealed range, and OutLayer runs the build this repo publishes.
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  accountCommitment,
  commitment,
  open,
  ownerCommitment,
  prepareGuard,
  seal,
  type SealContents,
} from '@ripcord/shared';

/** The guard as the registry returns it: hashes and a status, never an address. */
export interface OnChainGuard {
  commitment: string;
  owner_commitment: string;
  account_commitment: string;
  status: string;
}
export interface OnChainArm {
  at: string;
  epoch: number;
  /** The drawn line and target, sealed to the owner. */
  sealed: string;
}
export interface PublicOutcome {
  public: { outcome: string };
}

/** One epoch's line and top-up target, % from liquidation, as the enclave drew them. */
export interface Draw {
  epoch: number;
  line: number;
  target: number;
}

export interface Check {
  ok: boolean;
  title: string;
  detail: string;
}
export interface Verdict {
  settings: Check;
  draws: Check;
  code: Check;
  /** Rescues by public outcome. */
  rescues: Record<string, number>;
}

/** A percent as the app writes it: the sign touches the number, no trailing zeros (DESIGN §5). */
const pc = (n: number, digits = 1) => `${Number(n.toFixed(digits))}%`;
const between = ([lo, hi]: [number, number]) => `between ${pc(lo)} and ${pc(hi)}`;
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-6)}`;
/** "a", "a and b", "a, b and c". */
const words = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Opens each arm record with the owner's receipt key; null if any one doesn't open. */
export function openDraws(c: SealContents, arms: OnChainArm[]): Draw[] | null {
  try {
    return arms.map((a) => {
      const plain = open(hexToBytes(c.receipt_secret), hexToBytes(a.sealed), c.guard_id);
      const d = JSON.parse(new TextDecoder().decode(plain)) as Draw;
      return { epoch: d.epoch, line: d.line, target: d.target };
    });
  } catch {
    return null;
  }
}

const OUTCOME_WORDS: Record<string, [string, string]> = {
  saved: ['saved', 'saved'],
  early: ['close call', 'close calls'],
  pending: ['settling', 'settling'],
  failed: ['liquidated', 'liquidated'],
};

function rescueLine(rescues: Record<string, number>): string {
  const n = Object.values(rescues).reduce((s, x) => s + x, 0);
  if (n === 0) return 'No rescues yet.';
  const parts = Object.entries(rescues).map(([k, v]) => `${v} ${OUTCOME_WORDS[k]?.[v === 1 ? 0 : 1] ?? k}`);
  return `${n} ${n === 1 ? 'rescue' : 'rescues'}: ${parts.join(', ')}.`;
}

export function verify(o: {
  guard: OnChainGuard;
  contents: SealContents;
  draws: Draw[] | null;
  receipts: PublicOutcome[];
  /** The OutLayer project's active version (the wasm's sha256), or null when it couldn't be read. */
  running: string | null;
  published: string;
}): Verdict {
  const { settings: s, salt, owner_salt } = o.contents;
  const differ = [
    commitment(s, salt) !== o.guard.commitment && 'settings',
    ownerCommitment(s.owner, owner_salt) !== o.guard.owner_commitment && 'owner',
    accountCommitment(s.hl_address, s.account_salt) !== o.guard.account_commitment && 'account',
  ].filter((x): x is string => !!x);
  const settings: Check = differ.length
    ? {
        ok: false,
        title: "Settings don't match the seal",
        detail: `The ${words(differ)} fingerprint${differ.length > 1 ? 's' : ''} on NEAR ${differ.length > 1 ? 'differ' : 'differs'} from this seal file's.`,
      }
    : {
        ok: true,
        title: 'Settings match the seal',
        detail: 'The settings, owner and account in this seal file give the three fingerprints NEAR holds for it.',
      };

  const rescues: Record<string, number> = {};
  for (const r of o.receipts) rescues[r.public.outcome] = (rescues[r.public.outcome] ?? 0) + 1;
  const lines = between(s.line_range_pct);
  const targets = between(s.target_range_pct);
  let draws: Check;
  if (o.draws === null) {
    draws = {
      ok: false,
      title: "The guard's lines don't open",
      detail: "Its sealed line records don't open with this seal file's key, so they weren't sealed to this owner.",
    };
  } else if (o.draws.length === 0) {
    draws = {
      ok: true,
      title: 'No line drawn yet',
      detail: `It draws its first line, ${lines} from liquidation, on its first check. ${rescueLine(rescues)}`,
    };
  } else {
    const within = (x: number, [lo, hi]: [number, number]) => x >= lo - 1e-9 && x <= hi + 1e-9;
    const out = o.draws.find((d) => !within(d.line, s.line_range_pct) || !within(d.target, s.target_range_pct));
    draws = out
      ? {
          ok: false,
          title: 'A line fell outside your range',
          detail: `Line ${o.draws.indexOf(out) + 1} was drawn at ${pc(out.line, 2)} with a target of ${pc(out.target, 2)}; your lines are ${lines}, targets ${targets}.`,
        }
      : {
          ok: true,
          title: 'Every line it drew sat inside your range',
          detail: `${o.draws.length} ${o.draws.length === 1 ? 'line' : 'lines'} drawn, each ${lines} from liquidation, with top-up targets ${targets}. ${rescueLine(rescues)}`,
        };
  }

  const code: Check =
    o.running === null
      ? { ok: false, title: "Couldn't read the running code", detail: "OutLayer's project didn't answer. Try again." }
      : o.running === o.published
        ? {
            ok: true,
            title: 'It runs the published code',
            detail: `OutLayer runs build ${short(o.running)}: the sha256 this repository's build script prints.`,
          }
        : {
            ok: false,
            title: 'It runs different code',
            detail: `OutLayer runs ${short(o.running)}; this repository publishes ${short(o.published)}.`,
          };
  return { settings, draws, code, rescues };
}

/**
 * The example account's guard, made the way a real one is (prepareGuard), with three lines drawn inside its range
 * and two rescues, its records sealed to its own receipt key: Verify opens them with the same code as a real guard.
 */
export function exampleCase(random: (n: number) => Uint8Array) {
  const p = prepareGuard(
    {
      hl_address: '0x9c4e7a1b2c3d4e5f60718293a4b5c6d7e8f941f2',
      preset: 'balanced',
      distance: 17.3,
      budget_usd: 4000,
      reserve_asset: 'nep141:btc.omft.near',
      isolated: null,
      days: 90,
    },
    random,
    Date.now(),
  );
  const c = p.contents;
  const pk = hexToBytes(c.settings.receipt_pk.slice('x25519:'.length));
  const [lo, hi] = c.settings.line_range_pct;
  const [tlo, thi] = c.settings.target_range_pct;
  const arms: OnChainArm[] = [0.31, 0.74, 0.12].map((u, epoch) => ({
    at: String(Date.now() - (3 - epoch) * 86_400_000),
    epoch,
    sealed: bytesToHex(
      seal(
        pk,
        utf8ToBytes(JSON.stringify({ epoch, line: lo + u * (hi - lo), target: tlo + (1 - u) * (thi - tlo) })),
        c.guard_id,
        random,
      ),
    ),
  }));
  const guard: OnChainGuard = {
    commitment: p.commitment,
    owner_commitment: p.owner_commitment,
    account_commitment: p.account_commitment,
    status: 'Guarding',
  };
  const receipts: PublicOutcome[] = [{ public: { outcome: 'saved' } }, { public: { outcome: 'early' } }];
  return { contents: c, guard, arms, receipts, fingerprint: p.fingerprint };
}
