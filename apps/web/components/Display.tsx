// The display voice: a serif headline whose last word turns, in italic amber. One per screen; everything below it
// stays in the sans, so the app still reads as a tool.

/** The serif headline style; sizes are set where it's used. */
export const display = 'font-display font-normal tracking-[-0.015em] [text-wrap:balance]';

/** A headline whose last word turns: italic, in amber. */
export function Turned({ children }: { children: string }) {
  const i = children.trimEnd().lastIndexOf(' ');
  if (i < 0) return <span className="italic text-amber">{children}</span>;
  return (
    <>
      {children.slice(0, i + 1)}
      <span className="italic text-amber">{children.slice(i + 1)}</span>
    </>
  );
}
