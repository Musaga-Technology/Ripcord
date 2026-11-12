// An agent guarding its own position through Ripcord's MCP tools, as its session reads: each call and the answer the
// tool gives, in the tools' own words (services/mcp/src/tools.ts), with example values. Static on purpose: a page read
// as HTML shows it whole.
const STEPS: { call: string; answer: string[]; done?: boolean }[] = [
  { call: 'liquidation_risk("0x7a3f…c41e")', answer: ['Nearest: ETH long, 6.2% from liquidation.'] },
  {
    call: 'create_guard({ coin: "ETH" })',
    answer: [
      'Sealed guard g-k3vrq2m7xa for the ETH long (cross margin).',
      'Fingerprint 7F3A 91C2 ···· C91E. The seal file stays on this machine.',
    ],
  },
  {
    call: 'fund_guard({ from: "arbitrum" })',
    answer: ['Send exactly 1500 USDC on Arbitrum to 0x3c41…a91f.'],
  },
  {
    call: 'finish_guard()',
    answer: ['Guarding: the reserve landed and the guard is on NEAR.'],
    done: true,
  },
];

export function AgentSession() {
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-panel">
      <figcaption className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <span className="text-[14px] font-semibold">A trading agent guards itself</span>
        <span className="font-mono text-[12px] text-muted">example values</span>
      </figcaption>
      <ol className="flex flex-col gap-5 overflow-x-auto px-5 py-5 font-mono text-[13px] leading-[1.6]">
        {STEPS.map((s) => (
          <li key={s.call} className="flex flex-col gap-1">
            <span className="text-text">
              <span aria-hidden="true" className="text-amber">
                →{' '}
              </span>
              {s.call}
            </span>
            {s.answer.map((line) => (
              <span key={line} className={`pl-4 ${s.done ? 'text-amber' : 'text-text-2'}`}>
                {line}
              </span>
            ))}
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-5 py-3.5 font-mono text-[12px] text-muted">
        Any MCP client: corepack pnpm --filter @ripcord/mcp start
      </div>
    </figure>
  );
}
