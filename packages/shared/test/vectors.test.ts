// Golden vectors from scripts/vectors.py (the reference implementation). checker/tests/vectors.rs reads the
// same files, so TypeScript, Rust and Python must agree on every hash and every guard decision.
import { describe, expect, it } from 'vitest';
import commitmentV from '../vectors/commitment.json' with { type: 'json' };
import guardV from '../vectors/guard.json' with { type: 'json' };
import {
  accountCommitment,
  atHour,
  canonical,
  commitment,
  distancePct,
  draw,
  fallRate,
  fingerprint,
  fingerprintShort,
  guardDistance,
  guardIdFromBits,
  isGuardId,
  latencyS,
  ownerCommitment,
  ownerSalt,
  rescueSize,
  roundCredit,
  saveFee,
  settle,
  shouldFire,
  type GuardSettings,
  type Json,
  type Position,
} from '../src/index.js';

const close = (a: number | null, b: number | null) =>
  a === null || b === null ? expect(a).toBe(b) : expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));

describe('canonical JSON and commitments', () => {
  it.each(commitmentV.canonical)('canonical %#', (c) => expect(canonical(c.input as Json)).toBe(c.canonical));
  it.each(commitmentV.canonical_rejects)('rejects $why', (r) => expect(() => canonical(r.input as Json)).toThrow(r.why));
  it.each(commitmentV.commitments)('commitment: $name', (c) => {
    const s = c.settings as unknown as GuardSettings;
    expect(canonical(s as unknown as Json)).toBe(c.canonical);
    expect(commitment(s, c.salt)).toBe(c.commitment);
    expect(fingerprint(c.commitment)).toBe(c.fingerprint);
    expect(fingerprintShort(c.commitment)).toBe(c.fingerprint_short);
  });
  it.each(commitmentV.owners)('owner commitment: $owner', (o) => {
    expect(ownerSalt(o.signature)).toBe(o.owner_salt);
    expect(ownerCommitment(o.owner, o.owner_salt)).toBe(o.owner_commitment);
  });
  it.each(commitmentV.accounts)('account commitment', (a) =>
    expect(accountCommitment(a.hl_address, a.account_salt)).toBe(a.account_commitment),
  );
  it.each(commitmentV.guard_ids)('guard id from bits $bits', (g) => expect(guardIdFromBits(BigInt(g.bits))).toBe(g.guard_id));
  it.each(commitmentV.guard_id_checks)('guard id check $s', (g) => expect(isGuardId(g.s)).toBe(g.valid));
  it('a salt must be 64 lowercase hex characters', () => {
    expect(() => accountCommitment('0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3', 'AB'.repeat(32))).toThrow();
  });
});

describe('guard decisions', () => {
  it.each(guardV.distance)('distance %#', (d) => close(distancePct(d.liquidation_px, d.mark), d.distance_pct));
  it.each(guardV.guard_distance)('guard distance, isolated $isolated_coin', (g) =>
    close(guardDistance(g.positions as Position[], g.isolated_coin), g.distance_pct),
  );
  it.each(guardV.fall_rate)('fall rate %#', (f) => close(fallRate(f.history as [number, number][], f.now_t, f.now_d), f.v));
  it.each(guardV.should_fire)('fire %#', (f) => expect(shouldFire(f.distance, f.drawn_line, f.speed_aware, f.v)).toBe(f.fire));
  it.each(guardV.rescue_size)('rescue size %#', (s) => close(rescueSize(s), s.size_usd));
  it.each(guardV.save_fee)('save fee $t', (f) => close(saveFee(f.t), f.fee));
  it.each(guardV.round_credit)('round credit $x', (r) => expect(roundCredit(r.x)).toBe(r.credit));
  it.each(guardV.at_hour)('at hour $at_s', (h) => expect(atHour(h.at_s)).toBe(h.at_hour));
  it.each(guardV.latency_s)('latency $seconds', (l) => expect(latencyS(l.seconds)).toBe(l.latency_s));
  it.each(guardV.draw)('draw %#', (d) => close(draw(d.lo, d.hi, d.u), d.value));
  it.each(guardV.settle)('settle %#', (s) => expect(settle(s.szi, s.liq_before, s.mark, s.liquidated, s.age_s)).toBe(s.outcome));
});
