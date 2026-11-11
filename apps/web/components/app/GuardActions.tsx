'use client';

// What the owner can do with a guard (DESIGN §4.3): top up the reserve, change the rescue range, freeze the reserve,
// close the guard. On the example account each one works; on a real guard they arrive with the mainnet launch, and
// the panel says what each will do. One panel at a time, inline under the row; Escape closes it.
import { presetRanges, type Preset } from '@ripcord/shared';
import { useEffect, useState } from 'react';
import { radioKeys } from '../../lib/radio';
import { price } from '../format';
import { fieldCls, ghostBtn, primaryBtn } from './AppShell';

export interface Control {
  frozen: boolean;
  closed: boolean;
  /** Amounts added on top of the sealed reserve, in its asset. */
  added: number[];
  preset: Preset | null;
}

export const NO_CONTROL: Control = { frozen: false, closed: false, added: [], preset: null };

type Panel = 'topup' | 'range' | 'freeze' | 'close';

const PRESETS: { id: Preset; name: string }[] = [
  { id: 'safer', name: 'Safer' },
  { id: 'balanced', name: 'Balanced' },
  { id: 'lean', name: 'Lean' },
];

const pctRange = ([a, b]: [number, number]) => `${Math.round(a)}–${Math.round(b)}%`;

export function GuardActions({
  example,
  control,
  onChange,
  reserve,
  asset,
  distance,
  current = null,
  priceAt,
  busy = null,
}: {
  example: boolean;
  control: Control;
  onChange(c: Control): void;
  /** The reserve in words, e.g. "0.057 BTC". */
  reserve: string;
  asset: string;
  /** Distance from liquidation now: a new range is drawn from it. */
  distance: number;
  /** The preset the guard is sealed with now. */
  current?: Preset | null;
  /** The price at a distance from liquidation, % (for showing a range as prices). */
  priceAt?: (pct: number) => number;
  /** Why changes to the reserve are paused right now (a rescue in flight), if they are. */
  busy?: string | null;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [amount, setAmount] = useState('');
  const [preset, setPreset] = useState<Preset>(control.preset ?? current ?? 'balanced');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  const open = (p: Panel) => {
    setDone(null);
    setPanel(panel === p ? null : p);
  };
  const finish = (c: Control, message: string) => {
    onChange(c);
    setDone(message || null);
    setPanel(null);
  };

  if (control.closed) return null;

  const buttons: { id: Panel; label: string }[] = [
    { id: 'topup', label: 'Top up reserve' },
    { id: 'range', label: 'Change range' },
    { id: 'freeze', label: control.frozen ? 'Unfreeze reserve' : 'Freeze reserve' },
    { id: 'close', label: 'Close guard' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Guard actions" className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-expanded={panel === b.id}
            onClick={() => open(b.id)}
            disabled={(control.frozen || !!busy) && (b.id === 'topup' || b.id === 'range' || b.id === 'close')}
            className={`${ghostBtn} min-h-11 px-4 text-[14px] ${panel === b.id ? 'border-text' : ''}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      {(busy || control.frozen) && (
        <p className="text-[13px] text-muted">
          {busy ?? 'Top up, change range and close wait until you unfreeze the reserve.'}
        </p>
      )}
      {done && (
        <p aria-live="polite" className="flex items-center gap-2 text-[15px] text-text-2">
          <span className="h-[7px] w-[7px] rounded-full bg-green" />
          {done}
        </p>
      )}
      {panel && (
        <div className="step-in flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
          {!example ? (
            <Coming panel={panel} />
          ) : panel === 'topup' ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(amount);
                if (n > 0)
                  finish(
                    { ...control, added: [...control.added, n] },
                    `Added ${amount} ${asset}. Its size stays private.`,
                  );
              }}
            >
              <p className="text-[15px] text-text-2">
                More reserve means a bigger rescue, or a second one. It goes to a new private deposit address, like the
                first.
              </p>
              <label className="flex max-w-[240px] flex-col gap-1.5 text-[13px] text-muted">
                Amount in {asset}
                <input
                  inputMode="decimal"
                  className={fieldCls}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                />
              </label>
              <button type="submit" className={`${primaryBtn} w-fit`} disabled={!(Number(amount) > 0)}>
                Top up reserve
              </button>
            </form>
          ) : panel === 'range' ? (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] text-text-2">
                The new range is sealed like the first. Every line drawn after it falls inside the new range.
              </p>
              <div role="radiogroup" aria-label="When to step in" className="flex flex-wrap gap-2">
                {PRESETS.map((p) => {
                  const r = presetRanges(p.id, distance);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={preset === p.id}
                      tabIndex={preset === p.id ? 0 : -1}
                      onKeyDown={radioKeys}
                      disabled={!r}
                      onClick={() => setPreset(p.id)}
                      className={`flex min-h-11 flex-col rounded-[16px] border px-4 py-2 text-left text-[14px] transition-colors duration-[120ms] ${preset === p.id ? 'border-text' : 'border-line hover:border-line-3'}`}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        {p.name}
                        {p.id === current && <span className="text-[12px] font-medium text-muted">Current</span>}
                      </span>
                      <span className="tabular-nums text-text-2">
                        {r
                          ? priceAt
                            ? `Near ${price(priceAt((r.line_range_pct[0] + r.line_range_pct[1]) / 2))} · ${pctRange(r.line_range_pct)} away`
                            : `${pctRange(r.line_range_pct)} away`
                          : 'Too close'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className={`${primaryBtn} w-fit`}
                onClick={() =>
                  finish({ ...control, preset }, `Resealed: ${PRESETS.find((p) => p.id === preset)!.name}.`)
                }
              >
                Reseal range
              </button>
            </div>
          ) : panel === 'freeze' ? (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] text-text-2">
                {control.frozen
                  ? 'Unfreezing lets rescues reach your margin again.'
                  : 'Nothing can leave the reserve, rescues included, until you unfreeze it. It takes one signature with your owner key, and works even if Ripcord is down.'}
              </p>
              <button
                type="button"
                className={`${primaryBtn} w-fit`}
                onClick={() =>
                  finish(
                    { ...control, frozen: !control.frozen },
                    control.frozen ? 'Unfrozen. Rescues can reach your margin again.' : '',
                  )
                }
              >
                {control.frozen ? 'Unfreeze reserve' : 'Freeze reserve'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] text-text-2">
                The guard stops, and what is left of the reserve goes back to your own Hyperliquid account.
              </p>
              <button
                type="button"
                className={`${primaryBtn} w-fit`}
                onClick={() => finish({ ...control, closed: true }, '')}
              >
                Close and return {reserve}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Coming({ panel }: { panel: Panel }) {
  const what: Record<Panel, string> = {
    topup: 'A top-up goes to a new private deposit address, like the first funding.',
    range: 'A new range is sealed like the first, and every later line is drawn inside it.',
    freeze: 'One signature with your owner key freezes the reserve, even if Ripcord is down.',
    close: 'Closing returns what is left of the reserve to your own Hyperliquid account.',
  };
  return (
    <p className="text-[15px] text-text-2">
      {what[panel]} This arrives with the mainnet launch; try it in the simulation today.
    </p>
  );
}
