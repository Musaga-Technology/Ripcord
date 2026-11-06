import type { KeyboardEvent } from 'react';

/**
 * Arrow keys for a group of `role="radio"` buttons, as a radio group behaves natively: the arrows move the choice and
 * the focus together, and the group is one stop in the Tab order (the checked option carries `tabIndex` 0).
 */
export function radioKeys(e: KeyboardEvent<HTMLElement>): void {
  const dir = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
  if (!dir) return;
  e.preventDefault();
  const group = e.currentTarget.parentElement;
  const items = group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)')] : [];
  const next = items[(items.indexOf(e.currentTarget) + dir + items.length) % items.length];
  next?.focus();
  next?.click();
}
