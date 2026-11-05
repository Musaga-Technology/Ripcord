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

/** A section settles into place as it scrolls in. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`}>
      {children}
    </div>
  );
}

/** A number that counts up once it is seen, in tabular digits so nothing shifts. */
export function Count({ to, prefix = '', suffix = '' }: { to: number; prefix?: string; suffix?: string }) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(to);
    const t0 = performance.now();
    let raf = 0;
    const f = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [seen, to]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {Math.round(seen ? v : 0)}
      {suffix}
    </span>
  );
}
