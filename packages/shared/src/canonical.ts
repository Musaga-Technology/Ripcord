// Canonical JSON (docs/SPEC.md §1): keys sorted, no whitespace, numbers as decimal strings, EVM addresses
// lowercase. Mirrors checker/src/canonical.rs and scripts/vectors.py; the golden vectors keep all three equal.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const KEY = /^[a-z0-9_]+$/;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class CanonicalError extends Error {}

export function canonicalNumber(x: number): string {
  if (!Number.isFinite(x)) throw new CanonicalError('number must be finite');
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a < 1e-6 || a >= 1e15) throw new CanonicalError('number out of range');
  // In range, String() gives the shortest round-trip decimal without an exponent, as Rust and Python do.
  return String(x);
}

export function canonicalString(s: string): string {
  const v = ADDRESS.test(s) ? s.toLowerCase() : s;
  let out = '"';
  for (const ch of v) {
    const o = ch.codePointAt(0)!;
    if (o >= 0xd800 && o <= 0xdfff) throw new CanonicalError('lone surrogate');
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (o < 0x20) out += '\\u' + o.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

export function canonical(v: Json): string {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return '"' + canonicalNumber(v) + '"';
  if (typeof v === 'string') return canonicalString(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v);
  for (const k of keys) if (!KEY.test(k)) throw new CanonicalError('key must match [a-z0-9_]+');
  return (
    '{' +
    keys
      .sort()
      .map((k) => canonicalString(k) + ':' + canonical(v[k]!))
      .join(',') +
    '}'
  );
}
