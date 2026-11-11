// Verify's three checks: they pass for an honest guard, and each kind of tampering fails with its reason.
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { seal } from '@ripcord/shared';
import { describe, expect, it } from 'vitest';
import { random } from '../lib/backend';
import { exampleCase, openDraws, verify } from '../lib/verify';

const BUILD = '7d179aa3bfbf4c67b3b8ae77b7ed91e5125efe5f2dafe7293921d74d5dac2bf6';

function run(over: Partial<Parameters<typeof verify>[0]> = {}) {
  const e = exampleCase(random);
  return verify({
    guard: e.guard,
    contents: e.contents,
    draws: openDraws(e.contents, e.arms),
    receipts: e.receipts,
    running: BUILD,
    published: BUILD,
    ...over,
  });
}

describe('Verify', () => {
  it('passes an honest guard on all three, and counts its rescues', () => {
    const v = run();
    expect([v.settings.ok, v.draws.ok, v.code.ok]).toEqual([true, true, true]);
    expect(v.draws.detail).toMatch(/^3 lines drawn, each between \d+(\.\d)?% and \d+(\.\d)?% from liquidation/);
    expect(v.draws.detail).toContain('2 rescues: 1 saved, 1 close call.');
    expect(v.rescues).toEqual({ saved: 1, early: 1 });
  });

  it('names the fingerprint that differs', () => {
    const e = exampleCase(random);
    const base = { contents: e.contents, draws: openDraws(e.contents, e.arms), receipts: e.receipts };
    const one = verify({
      ...base,
      guard: { ...e.guard, account_commitment: 'ab'.repeat(32) },
      running: BUILD,
      published: BUILD,
    });
    expect(one.settings).toMatchObject({ ok: false, title: "Settings don't match the seal" });
    expect(one.settings.detail).toBe("The account fingerprint on NEAR differs from this seal file's.");
    const another = exampleCase(random).guard;
    const all = verify({ ...base, guard: another, running: BUILD, published: BUILD });
    expect(all.settings.detail).toBe(
      "The settings, owner and account fingerprints on NEAR differ from this seal file's.",
    );
  });

  it('fails a line drawn outside the sealed range', () => {
    const e = exampleCase(random);
    const [, hi] = e.contents.settings.line_range_pct;
    const draws = [...(openDraws(e.contents, e.arms) ?? []), { epoch: 3, line: hi + 0.5, target: 10 }];
    const v = verify({ guard: e.guard, contents: e.contents, draws, receipts: [], running: BUILD, published: BUILD });
    expect(v.draws.ok).toBe(false);
    expect(v.draws.title).toBe('A line fell outside your range');
    expect(v.draws.detail).toContain('Line 4');
  });

  it('checks each line against the range in force when it was drawn', () => {
    const e = exampleCase(random);
    const old = e.contents.settings;
    const up = ([lo, hi]: [number, number]): [number, number] => [lo + 5, hi + 5];
    const contents = {
      ...e.contents,
      settings: { ...old, line_range_pct: up(old.line_range_pct), target_range_pct: up(old.target_range_pct) },
      earlier: [{ until_epoch: 3, line_range_pct: old.line_range_pct, target_range_pct: old.target_range_pct }],
    };
    const before = openDraws(e.contents, e.arms) ?? [];
    expect(before.map((d) => d.epoch)).toEqual([0, 1, 2]);
    const mid = ([lo, hi]: [number, number]) => (lo + hi) / 2;
    const after = {
      epoch: 3,
      line: mid(contents.settings.line_range_pct),
      target: mid(contents.settings.target_range_pct),
    };
    const check = (draws: typeof before) =>
      verify({ guard: e.guard, contents, draws, receipts: [], running: BUILD, published: BUILD }).draws;

    const ok = check([...before, after]);
    expect(ok.ok).toBe(true);
    expect(ok.detail).toMatch(/^4 lines drawn: 3 inside the range you had before, and 1 inside today's/);
    // A line from the old range after the change, or from the new range before it, is outside.
    expect(check([...before, { ...before[0]!, epoch: 3 }]).ok).toBe(false);
    expect(check([{ ...after, epoch: 1 }, ...before.slice(1)]).ok).toBe(false);
  });

  it("fails lines that weren't sealed to this owner", () => {
    const e = exampleCase(random);
    const stranger = exampleCase(random);
    const pk = hexToBytes(stranger.contents.settings.receipt_pk.slice('x25519:'.length));
    const forged = [
      { at: '0', epoch: 0, sealed: bytesToHex(seal(pk, utf8ToBytes('{}'), e.contents.guard_id, random)) },
    ];
    expect(openDraws(e.contents, forged)).toBeNull();
    expect(run({ guard: e.guard, contents: e.contents, draws: null }).draws.ok).toBe(false);
  });

  it('passes a new guard with no line yet, and says so', () => {
    const v = run({ draws: [], receipts: [] });
    expect(v.draws).toMatchObject({ ok: true, title: 'No line drawn yet' });
    expect(v.draws.detail).toContain('No rescues yet.');
  });

  it('fails code that is not the published build, or that could not be read', () => {
    expect(run({ running: 'ff'.repeat(32) }).code).toMatchObject({ ok: false, title: 'It runs different code' });
    expect(run({ running: null }).code.ok).toBe(false);
  });
});
