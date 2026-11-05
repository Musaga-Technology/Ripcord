import { demoRows, DEMO_TRADER } from '@ripcord/shared/mock';
import { Dashboard } from '../../components/Dashboard';
import { ThemeToggle } from '../../components/ThemeToggle';
import { usd } from '../../components/format';

function Logo() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="9.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11" cy="11" r="5.5" stroke="var(--amber)" strokeWidth="1.4" />
    </svg>
  );
}

export default function GuardsPage() {
  const rows = demoRows();
  const guarded = rows.filter((r) => r.guard);
  const notional = guarded.reduce((s, r) => s + r.size * r.mark, 0);
  const short = `${DEMO_TRADER.slice(0, 6)}…${DEMO_TRADER.slice(-4)}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-4 px-[max(16px,env(safe-area-inset-left))] py-3.5 sm:px-8">
          <div className="flex flex-wrap items-center gap-9">
            <span className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
              <Logo />
              Ripcord
            </span>
            <nav aria-label="App" className="flex gap-1.5 text-[15px]">
              <span aria-current="page" className="rounded-full bg-line px-3 py-2">
                Guards
              </span>
              <span className="rounded-full px-3 py-2 text-muted" title="Arrives on Day 8">
                Ledger
              </span>
              <span className="rounded-full px-3 py-2 text-muted" title="Arrives on Day 8">
                Verify
              </span>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="hidden text-[13px] text-muted sm:inline">Demo · example account</span>
            <span className="rounded-full border border-line-3 px-3 py-2 font-mono text-[13px] text-text-2">
              {short}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1360px] flex-col gap-6 px-[max(16px,env(safe-area-inset-left))] py-7 sm:px-8">
        <section
          aria-label="Summary"
          className="grid grid-cols-2 rounded-[20px] border border-line bg-panel md:grid-cols-5"
        >
          <Stat label="Account value" value="$28,410.55" />
          <Stat label="Guarded notional" value={usd(notional)} note={`${guarded.length} of ${rows.length}`} />
          <Stat label="Reserve" value="••••••" mono />
          <Stat label="Rescues · 30 days" value="3" note="1 saved" />
          <Stat label="Median rescue time" value="39 s" />
        </section>

        <Dashboard rows={rows} />

        <p className="text-[13px] text-muted">
          Demo mode: an example account and example guards. No wallet is connected and no funds move.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-line px-5 py-4 [&:not(:first-child)]:md:border-l">
      <span className="text-[13px] text-muted">{label}</span>
      <span
        className={`text-[20px] font-semibold tracking-[-0.02em] tabular-nums ${mono ? 'font-mono tracking-[0.2em]' : ''}`}
      >
        {value} {note ? <span className="text-[13px] font-medium tracking-normal text-muted">{note}</span> : null}
      </span>
    </div>
  );
}
