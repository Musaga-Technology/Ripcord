'use client';

// Verify (docs/DESIGN.md §4.6): a seal file and its passphrase open the guard here, then three checks run against what
// NEAR holds. Nothing leaves this device; the example guard runs the same checks on example records, and reads the
// running build live.
import { fingerprint, isSealFile, readSealFile, type SealContents, type SealFile } from '@ripcord/shared';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { random, readArms, readGuardHashes, readReceipts, readRunningBuild } from '../../lib/backend';
import { accountUrl, CHECKER_HASH, codeUrl, NETWORK, REGISTRY } from '../../lib/near';
import { SessionProvider } from '../../lib/session';
import { exampleCase, openDraws, verify, type Check, type Verdict } from '../../lib/verify';
import { usd } from '../format';
import { GuardCard } from '../GuardCard';
import { AppShell, fieldCls, ghostBtn, primaryBtn } from './AppShell';
import { assetOf } from './steps';

interface Opened {
  contents: SealContents;
  commitment: string;
  /** The example guard's own records, made and sealed the way a real guard's are. */
  example: ReturnType<typeof exampleCase> | null;
}

type Phase = { at: 'idle' } | { at: 'checking'; opened: Opened } | { at: 'done'; opened: Opened; verdict: Verdict };

const DOTS = '••••••';
const netName = NETWORK === 'mainnet' ? 'NEAR' : 'NEAR testnet';
const pc = (n: number) => `${Number(n.toFixed(1))}`;

function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-green' : 'bg-red'} text-ground`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
        {ok ? <path d="M2.5 6.2 5 8.6l4.5-5" /> : <path d="m3 3 6 6M9 3 3 9" />}
      </svg>
    </span>
  );
}

function Ticks({ verdict, links }: { verdict: Verdict | null; links: [string, string][][] }) {
  const checks: (Check | null)[] = verdict ? [verdict.settings, verdict.draws, verdict.code] : [null, null, null];
  return (
    <ol className="flex flex-col" aria-live="polite">
      {checks.map((c, i) => (
        <li
          key={i}
          className={`flex gap-4 border-b border-line py-5 first:pt-0 last:border-b-0 ${c ? 'tick-in' : ''}`}
          style={c ? { animationDelay: `calc(var(--dur-4) + ${i * 120}ms)` } : undefined}
        >
          {c ? (
            <>
              <Mark ok={c.ok} />
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-[17px] font-semibold tracking-[-0.01em]">
                  <span className="sr-only">{c.ok ? 'Passed: ' : 'Failed: '}</span>
                  {c.title}
                </h3>
                <p className="text-[15px] text-text-2">{c.detail}</p>
                {links[i] && links[i]!.length > 0 && (
                  <p className="flex flex-wrap gap-x-4 text-[13px] text-muted">
                    {links[i]!.map(([label, href]) => (
                      <a
                        key={href}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-8 items-center underline decoration-line-3 underline-offset-4 hover:text-text"
                      >
                        {label}
                      </a>
                    ))}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-line" />
              <div className="flex flex-1 flex-col gap-2 pt-0.5">
                <span className="h-[18px] w-3/5 rounded-full bg-line" />
                <span className="h-[14px] w-full rounded-full bg-line" />
              </div>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The card under its veil; the veil slides off at −12° once the checks are in (DESIGN §8.1, opening the envelope). */
function Envelope({ opened, verdict }: { opened: Opened; verdict: Verdict | null }) {
  const s = opened.contents.settings;
  const coin = s.isolated?.coin;
  const passed = verdict && verdict.settings.ok && verdict.draws.ok && verdict.code.ok;
  const [lo, hi] = s.line_range_pct;
  return (
    <div className="relative">
      <div aria-hidden={!verdict}>
        <GuardCard
          label={coin ? `${coin} isolated` : 'Cross margin'}
          distance={verdict ? `${pc(lo)}–${pc(hi)}%` : DOTS}
          sub={verdict ? 'from liquidation, the sealed rescue range' : 'sealed'}
          fingerprint={fingerprint(opened.commitment)}
          commitment={opened.commitment}
          state={!verdict ? 'draft' : passed ? 'rescued' : 'paused'}
          status={!verdict ? 'Sealed' : passed ? 'Verified' : 'Not verified'}
          reserve={verdict ? `${usd(s.budget_usd)} in ${assetOf(s.reserve_asset).symbol}` : DOTS}
        />
      </div>
      <div aria-hidden="true" className={`veil ${verdict ? 'veil-off' : ''}`} />
    </div>
  );
}

function Picker({ onOpened }: { onOpened(o: Opened): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<SealFile | null>(null);
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const v: unknown = JSON.parse(await f.text());
      if (!isSealFile(v)) throw new Error('not a seal file');
      setFile(v);
      setName(f.name);
    } catch {
      setError("That isn't a seal file. It's the .json file saved when the guard was sealed.");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const contents = await readSealFile(file, pass);
      onOpened({ contents, commitment: file.commitment, example: null });
    } catch {
      setError("That passphrase doesn't open this seal file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={pick}
      />
      {file ? (
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 truncate text-[15px] text-text-2 underline decoration-line-3 underline-offset-4 hover:text-text"
            onClick={() => input.current?.click()}
            title="Choose another seal file"
          >
            {name || file.guard_id}
          </button>
          <input
            type="password"
            autoFocus
            aria-label="Passphrase"
            placeholder="Passphrase"
            autoComplete="current-password"
            className={`${fieldCls} sm:w-[240px]`}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button type="submit" className={primaryBtn} disabled={!pass || busy}>
            {busy ? 'Opening…' : 'Verify'}
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={primaryBtn} onClick={() => input.current?.click()}>
            Choose seal file
          </button>
          <button
            type="button"
            className={ghostBtn}
            onClick={() => {
              const e = exampleCase(random);
              onOpened({ contents: e.contents, commitment: e.guard.commitment, example: e });
            }}
          >
            Verify an example guard
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[15px] text-red">
          {error}
        </p>
      )}
    </div>
  );
}

function Verify() {
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const check = async (opened: Opened) => {
    const me = ++run.current;
    setError(null);
    setPhase({ at: 'checking', opened });
    const id = opened.contents.guard_id;
    try {
      const running = await readRunningBuild().catch(() => null);
      let verdict: Verdict;
      if (opened.example) {
        // Example records; only the running build is read live.
        const e = opened.example;
        verdict = verify({
          guard: e.guard,
          contents: e.contents,
          draws: openDraws(e.contents, e.arms),
          receipts: e.receipts,
          running,
          published: CHECKER_HASH,
        });
      } else {
        const [guard, arms, receipts] = await Promise.all([readGuardHashes(id), readArms(id), readReceipts(id)]);
        if (!guard) {
          if (me === run.current) {
            setPhase({ at: 'idle' });
            setError(`${netName} has no guard ${id}. It may not be registered yet, or it's on another network.`);
          }
          return;
        }
        verdict = verify({
          guard,
          contents: opened.contents,
          draws: openDraws(opened.contents, arms ?? []),
          receipts: receipts ?? [],
          running,
          published: CHECKER_HASH,
        });
      }
      // Let the skeleton be seen for a beat, so the envelope visibly opens.
      await new Promise((r) => setTimeout(r, 450));
      if (me === run.current) setPhase({ at: 'done', opened, verdict });
    } catch {
      if (me === run.current) {
        setPhase({ at: 'idle' });
        setError(`${netName} didn't answer. Try again in a moment.`);
      }
    }
  };

  // /verify?example opens the example guard straight away, for links from the rest of the app.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('example')) {
      const e = exampleCase(random);
      void check({ contents: e.contents, commitment: e.guard.commitment, example: e });
    }
    // Once, on arrival.
  }, []);

  const opened = phase.at === 'idle' ? null : phase.opened;
  const verdict = phase.at === 'done' ? phase.verdict : null;
  const links: [string, string][][] = [
    opened?.example ? [] : [['The guard on NEAR', accountUrl(REGISTRY)]],
    [],
    [['Rebuild it yourself', codeUrl('checker/build.sh')]],
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">Verify a guard.</h1>
        <p className="max-w-[60ch] text-[17px] text-text-2">
          Open its seal file here to check that it did only what was sealed. Nothing leaves this device.
        </p>
      </header>
      {phase.at === 'idle' ? (
        <>
          <Picker onOpened={(o) => void check(o)} />
          {error && (
            <p role="alert" className="text-[15px] text-red">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-muted">
          <span>
            {opened?.example ? 'Example guard' : 'Guard'}{' '}
            <span className="font-mono text-text-2">{opened?.contents.guard_id}</span>
          </span>
          <button
            type="button"
            className="inline-flex min-h-11 items-center underline decoration-line-3 underline-offset-4 hover:text-text"
            onClick={() => {
              run.current++;
              setPhase({ at: 'idle' });
            }}
          >
            Verify another
          </button>
        </div>
      )}
      {opened && (
        <section
          aria-label="Result"
          className="grid grid-cols-[minmax(0,1fr)] gap-8 rounded-[20px] border border-line bg-panel p-5 sm:p-7 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-12"
        >
          <div className="mx-auto w-full max-w-[420px]">
            <Envelope opened={opened} verdict={verdict} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Ticks verdict={verdict} links={links} />
            <p className="text-[13px] text-muted">
              {opened.example
                ? `Example data, made and sealed the way a real guard's is. The running build is read live from OutLayer on ${netName}.`
                : `Checked on this device against ${netName} and OutLayer. Nothing was sent anywhere.`}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

export function VerifyView() {
  return (
    <SessionProvider>
      <AppShell>
        <Verify />
      </AppShell>
    </SessionProvider>
  );
}
