'use client';

import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';
const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Choice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Follows the system by default (DESIGN §6); the choice is remembered on this device only. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>('system');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ripcord-theme');
      if (saved === 'light' || saved === 'dark') setChoice(saved);
    } catch {
      // Storage can be blocked; the system setting still applies.
    }
  }, []);

  const change = () => {
    const next = NEXT[choice];
    setChoice(next);
    const root = document.documentElement;
    if (next === 'system') delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      if (next === 'system') localStorage.removeItem('ripcord-theme');
      else localStorage.setItem('ripcord-theme', next);
    } catch {
      // Not remembered, but applied for this visit.
    }
  };

  return (
    <button
      type="button"
      onClick={change}
      className="inline-flex min-h-10 min-w-10 items-center justify-center whitespace-nowrap rounded-full border border-line-3 px-3 text-[13px] text-muted hover:text-text"
      aria-label={`Theme: ${LABEL[choice]}. Change theme`}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="sm:hidden">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        {choice !== 'light' && <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />}
        {choice === 'dark' && <path d="M8 2.5a5.5 5.5 0 0 0 0 11Z" fill="currentColor" />}
      </svg>
      <span className="hidden sm:inline">Theme: {LABEL[choice]}</span>
    </button>
  );
}
