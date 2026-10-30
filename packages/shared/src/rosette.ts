// The guard card's guilloche rosette (docs/DESIGN.md §2): deterministic from the commitment hash, so the same
// guard draws the same rosette everywhere (card, verify page, seal file icon, OG image). Paths fit a 600 × 378 box.

export interface Rosette {
  outer: string;
  inner: string;
}

export function rosette(commitmentHex: string): Rosette {
  const b: number[] = [];
  for (let i = 0; i + 1 < commitmentHex.length; i += 2) b.push(parseInt(commitmentHex.slice(i, i + 2), 16));
  const at = (i: number) => b[i] ?? 0;
  const k = 5 + (at(0) % 5);
  const m = 2 + (at(1) % 3);
  const curves = 14 + (at(2) % 8);
  const a = 0.06 + (at(3) / 255) * 0.04;
  const bb = 0.025 + (at(4) / 255) * 0.03;
  const ph = (at(5) / 255) * Math.PI * 2;
  const cx = 430 + (at(6) % 80);
  const cy = 250 + (at(7) % 70);
  const r = 228 + (at(8) % 40);
  const ring = (r0: number, amp: number, amp2: number, kk: number, phi: number, steps: number) => {
    let s = '';
    for (let j = 0; j <= steps; j++) {
      const th = (j / steps) * Math.PI * 2;
      const rr = r * (r0 + amp * Math.sin(kk * th + phi) + amp2 * Math.sin(m * kk * th - 2 * phi));
      s += (j ? 'L' : 'M') + (cx + rr * Math.cos(th)).toFixed(1) + ' ' + (cy + rr * Math.sin(th)).toFixed(1);
    }
    return s + 'Z';
  };
  let outer = '';
  let inner = '';
  for (let c = 0; c < curves; c++) outer += ring(0.8, a, bb, k, ph + (c / curves) * ((2 * Math.PI) / k), 170);
  for (let c = 0; c < Math.ceil(curves / 2); c++) {
    inner += ring(0.38, a * 0.8, bb * 0.8, k + 2, ph * 1.7 + (c / curves) * ((2 * Math.PI) / (k + 2)), 150);
  }
  return { outer, inner };
}
