'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Calls back once when the element scrolls into view (and at once under reduced motion). */
export function useInView<T extends Element>(margin = '-12% 0px'): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, seen];
}

/**
 * A block of the page. Content is visible as rendered, with no entrance: motion is kept for the rescue itself and the
 * few moments DESIGN §8 names, and a page read as HTML or captured whole shows everything.
 */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

/**
 * A number that counts up when it scrolls into view. The HTML carries the real value; only a number that starts out
 * of view is set back to zero, unseen, to count up when it arrives.
 */
export function Count({ to, prefix = '', suffix = '' }: { to: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) return;
    setV(0);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const f = (now: number) => {
        const k = Math.min(1, (now - t0) / 900);
        setV(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(f);
      };
      raf = requestAnimationFrame(f);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {Math.round(v)}
      {suffix}
    </span>
  );
}
