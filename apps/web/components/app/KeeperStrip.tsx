// The keepers around a simulated guard: each asks the enclave to check it now and then, none can see its line, and
// the one whose check fires a rescue is credited the market's bounty.
import { KEEPER_BOUNTY, KEEPER_MARKET_URL, KEEPERS } from '../../lib/keepers';

export function KeeperStrip({
  winner,
  watching,
  landed,
}: {
  /** The keeper whose check fired the latest rescue, if one has fired. */
  winner: number | null;
  /** Prices are moving: the keepers are checking. */
  watching: boolean;
  /** That rescue has landed, so its credit is due. */
  landed: boolean;
}) {
  return (
    <section
      aria-label="Keepers"
      className="mt-4 flex flex-col gap-3 rounded-[20px] border border-line bg-panel px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {KEEPERS.map((k, i) => (
          <span
            key={k}
            title={k}
            className={`h-2.5 w-2.5 rounded-full ${
              i === winner ? 'bg-amber' : watching ? 'chip-pulse bg-text-2' : 'bg-line-3'
            }`}
            style={watching && i !== winner ? { animationDelay: `${(i * 137) % 900}ms` } : undefined}
          />
        ))}
      </div>
      <p className="min-w-0 text-[14px] text-text-2">
        {winner === null ? (
          <>
            {KEEPERS.length} keepers watching this guard. None of them can see its line; the first to catch it in danger
            fires the rescue.
          </>
        ) : (
          <>
            <span className="font-mono text-text">{KEEPERS[winner]}</span> fired this rescue
            {landed ? (
              <>
                {' '}
                · credited <span className="text-amber">+{KEEPER_BOUNTY} NEAR</span> on the{' '}
                <a href={KEEPER_MARKET_URL} className="underline decoration-line-3 underline-offset-4 hover:text-text">
                  keeper market
                </a>
              </>
            ) : (
              ' · its credit lands with the rescue'
            )}
          </>
        )}
      </p>
    </section>
  );
}
