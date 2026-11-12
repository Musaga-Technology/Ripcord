// "Now": where something stands in one plain sentence, the one next step, and a few facts. The Guards home and each
// Guard page open with it, so a person always knows what to do next before the details.
import type { ReactNode } from 'react';
import { Turned, display } from './Display';

export function Now({
  title,
  children,
  action,
  facts,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  facts?: [string, ReactNode][];
}) {
  return (
    <section
      aria-label="Now"
      className="flex min-w-0 flex-col gap-4 rounded-[20px] border border-line bg-panel p-5 sm:p-6"
    >
      <h2 className={`${display} text-[36px] leading-[1.05] sm:text-[42px]`}>
        <Turned>{title}</Turned>
      </h2>
      {children && <div className="max-w-[36rem] text-[15px] text-text-2">{children}</div>}
      {action && <div className="flex flex-wrap items-center gap-x-5 gap-y-3">{action}</div>}
      {facts && facts.length > 0 && (
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[13px] text-muted">{label}</dt>
              <dd className="text-[15px] font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** A quiet link-styled button for a secondary step. */
export function QuietLink({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center text-[15px] underline decoration-line-3 underline-offset-4 hover:text-text"
    >
      {children}
    </button>
  );
}
