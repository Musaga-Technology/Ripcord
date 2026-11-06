'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that follows its value, and counts across a jump instead of snapping (DESIGN §8.1: when a rescue lands the
 * card's distance counts back up). Small moves pass straight through; tabular digits keep it from shifting.
 */
export function Ticker({
  value,
  digits = 1,
  suffix = '',
  jump = 0.5,
}: {
  value: number;
  digits?: number;
  suffix?: string;
  jump?: number;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const start = from.current;
    if (Math.abs(value - start) < jump || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 420);
      const v = start + (value - start) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, jump]);
  return (
    <span className="tabular-nums">
      {shown.toFixed(digits)}
      {suffix}
    </span>
  );
}
