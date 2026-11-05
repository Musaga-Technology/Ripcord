'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The guard card as an object: it turns toward the pointer anywhere on the page, floats when the pointer is still,
 * and shows its edge when it turns, like a metal card in the hand. Still under `prefers-reduced-motion`.
 */
export function Card3D({ children, max = 9 }: { children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let lastMove = -Infinity;
    let raf = 0;
    const start = performance.now();
    const clamp = (x: number) => Math.max(-1, Math.min(1, x));
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.9));
      ty = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 1.4));
      lastMove = performance.now();
    };
    const loop = (now: number) => {
      const idle = now - lastMove > 2500;
      const s = (now - start) / 1000;
      const gx = idle ? Math.sin(s * 0.45) * 0.45 : tx;
      const gy = idle ? Math.cos(s * 0.37) * 0.3 : ty;
      cx += (gx - cx) * 0.06;
      cy += (gy - cy) * 0.06;
      el.style.setProperty('--rx', `${(-cy * max).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(cx * max).toFixed(2)}deg`);
      el.style.setProperty('--sx', `${(-cx * 18).toFixed(1)}px`);
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [max]);

  return (
    <div ref={ref} className="card-3d relative" style={{ perspective: '1600px' }}>
      <div aria-hidden="true" className="card-shadow" />
      <div className="card-3d-body relative" style={{ transformStyle: 'preserve-3d' }}>
        {[6, 4, 2].map((z) => (
          <div key={z} aria-hidden="true" className="card-edge" style={{ transform: `translateZ(-${z}px)` }} />
        ))}
        {children}
      </div>
    </div>
  );
}
