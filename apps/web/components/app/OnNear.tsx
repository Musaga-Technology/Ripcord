// What this guard runs on, piece by piece, with the links that prove each: the app's own "how NEAR keeps it hidden",
// for one guard. Plain words first; the NEAR piece names the work it does.
import { accountUrl, CHECKER_HASH, codeUrl, FREEZE_TX, REGISTRY, short, txUrl } from '../../lib/near';

export function OnNear({ guardId, example }: { guardId: string; example: boolean }) {
  const rows: { what: string; how: string; link?: { label: string; href: string } }[] = [
    {
      what: 'Your line',
      how: "Sealed in OutLayer's enclave on NEAR. Only it reads your settings and decides when to step in.",
      link: { label: `Build ${short(CHECKER_HASH)}`, href: codeUrl('checker/build.sh') },
    },
    {
      what: 'Your reserve',
      how: "A NEAR Confidential Intents balance held by this guard's own wallet. It can pay only your Hyperliquid account.",
      link: { label: 'Its rules', href: codeUrl('checker/src/policy.rs') },
    },
    {
      what: 'A rescue',
      how: 'NEAR Intents turns part of the reserve into USDC in your Hyperliquid margin, in one private step.',
    },
    {
      what: 'Its record',
      how: example
        ? 'A NEAR contract holds each guard as hashes, never an address. This example guard is not on chain.'
        : `A NEAR contract holds this guard (${guardId}) as hashes, never an address, and its receipts.`,
      link: { label: 'The registry', href: accountUrl(REGISTRY) },
    },
    {
      what: 'A freeze',
      how: 'One signature with your owner key, checked by that contract. It works even if Ripcord is down.',
      link: { label: 'A freeze on NEAR', href: txUrl(FREEZE_TX) },
    },
  ];
  return (
    <section aria-label="On NEAR" className="mt-3 rounded-[20px] border border-line bg-panel px-5 py-4 sm:px-6">
      <h2 className="text-[15px] font-semibold">On NEAR</h2>
      <ul className="mt-1 grid gap-x-8 sm:grid-cols-2">
        {rows.map((r) => (
          <li
            key={r.what}
            className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
          >
            <span className="text-[13px] text-muted">{r.what}</span>
            <span className="text-[14px] text-text-2">{r.how}</span>
            {r.link && (
              <a
                href={r.link.href}
                className="inline-flex min-h-9 w-fit items-center gap-1.5 text-[13px] font-medium underline decoration-line-3 underline-offset-4 hover:decoration-text"
              >
                {r.link.label}
                <span aria-hidden="true">↗</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
