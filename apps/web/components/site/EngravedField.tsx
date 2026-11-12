// The engraved field behind the landing hero: the seal's guilloche, very large and very faint, so the page carries the
// same security-printing texture as the logo, the cards and the X banner. Drawn once on the server; decorative only.
function rings(cx: number, cy: number, r: number, k: number, curves: number, a: number, steps = 540) {
  let d = '';
  for (let c = 0; c < curves; c++) {
    const ph = 0.6 + (c / curves) * ((2 * Math.PI) / k);
    for (let j = 0; j <= steps; j++) {
      const th = (j / steps) * Math.PI * 2;
      const rr = r * (1 + a * Math.sin(k * th + ph) + a * 0.45 * Math.sin(3 * k * th - 2 * ph));
      d += (j ? 'L' : 'M') + (cx + rr * Math.cos(th)).toFixed(1) + ' ' + (cy + rr * Math.sin(th)).toFixed(1);
    }
    d += 'Z';
  }
  return d;
}

const OUTER = rings(600, 600, 520, 7, 30, 0.085);
const INNER = rings(600, 600, 230, 9, 14, 0.1);

export function EngravedField({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 1200 1200" fill="none" className={`pointer-events-none ${className}`}>
      <path d={OUTER} stroke="var(--text)" strokeOpacity="0.07" strokeWidth="0.8" />
      <path d={INNER} stroke="var(--amber)" strokeOpacity="0.22" strokeWidth="0.9" />
    </svg>
  );
}
