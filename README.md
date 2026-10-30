# Ripcord

**Hidden margin that lands before the liquidator does.**

On Hyperliquid, everyone can see the price where your position gets liquidated, and some traders push price toward it. Ripcord keeps a hidden reserve, in any asset on any chain, and moves it into your margin account seconds before liquidation. You give no keys and use no new exchange, and nobody can see how deep your defence goes.

Built for NEAR HACKATHON (Oct 19 – Nov 14, 2026). Tracks: `defi`, `privacy`, `security`, `agents`.

Design notes, research and feasibility tests were prepared from Oct 20 (results summarised in `docs/EVIDENCE.md`), inside the hackathon window that opened with the Oct 19 announcement. All code in this repository is written from Oct 30 to Nov 14; the October test scripts are not part of it. Libraries are listed under "Built with".

> ⚠️ This README is a skeleton for v2. Sections marked _(fill in)_ get real numbers and links during the build. Every section must be true on submission day.

## The problem

- Every Hyperliquid position (size, entry, margin, liquidation price) is public. Heatmap tools draw every trader's liquidation level in real time, and hunting those levels is a documented pattern.
- The only defence today is visible: extra USDC parked on the exchange, which tells a hunter exactly how far to push, or watching the screen all night.
- Existing protection is tied to one venue (Synthetix Wick Insurance) or covers lending only (DeFi Saver). We found none for Hyperliquid.

## How it works

1. Sign in with the wallet you trade with. Ripcord reads your Hyperliquid positions from the public API. You approve nothing on Hyperliquid.
2. Set a guard: "rescue me somewhere between 5 % and 8 % from liquidation". Or say it in plain English and confirm what Ripcord reads back. The guard picks the exact point privately and changes it after every rescue, so watching rescues doesn't reveal it.
3. Your browser seals the settings. It encrypts them to the guard running in an OutLayer TEE and publishes only a fingerprint. You keep a **seal file**.
4. Fund a reserve in any supported asset (BTC, SOL, ETH, NEAR, USDC…) from its own chain. It sits in a Confidential Intents balance, so its size is private.
5. The guard reads your account inside the TEE. When you cross your line, it swaps part of the reserve into USDC through NEAR Intents and has it credited to **your** Hyperliquid perps balance in under a minute (about 45 s end to end, measured on mainnet). Your liquidation price moves away.
6. Hunters can see that USDC arrived. They can't link it to the reserve, see what's left, or look up which accounts are guarded: the registry stores only hashes.
7. Close any time: the rest of the reserve goes to the chain and address you choose. With your seal file, anyone can verify every rescue happened inside your sealed line.

**For AI trading agents** _(fill in from Nov 11)_: an MCP tool lets an agent hire a guard for its own positions. You seal the guard, so the agent can't see or change it.

## Try it (demo mode, no funds needed)

| Do | See |
|---|---|
| `bash scripts/demo.sh` | Installs, runs TS + Rust tests, builds the web app, ends with "✓ All green" |
| _(fill in from Nov 6)_ open http://localhost:3000, **Guard a position** with the demo account | Positions with public liquidation prices; the defence line is sealed under a security tint |
| _(fill in from Nov 9)_ **Try to hunt one** | Hunt simulator: push price at a guarded position and watch hidden rescues move the line |
| _(fill in from Nov 8)_ **Verify**, drop the demo seal file | Three green ticks: settings match the seal, rescues inside the line, code hash matches |

## Mainnet proof _(fill in Nov 7)_

| Step | Link |
|---|---|
| Reserve funded with BTC (confidential) | |
| Breach → rescue intent signed in TEE | |
| USDC credited to Hyperliquid perps balance | |

Measured: breach → credited p50 ___ s, p95 ___ s · cost per check ___ · cost per rescue ___.

## Built on NEAR

Every row links the code that uses the piece and a test or transaction that proves it. Rows marked _(Day n)_ get their links on the day that code is written.

| NEAR piece | What it does in Ripcord | Code | Proof |
|---|---|---|---|
| NEAR Intents · 1Click | Reserve deposits from 35+ chains; a rescue is a swap to USDC credited straight to a Hyperliquid perps balance | `checker/` rescue executor _(Day 5)_ | mainnet rescue tx _(Day 7)_ |
| Confidential Intents | Private reserve; rescues can't be linked to it | `checker/` custody calls _(Day 3, 5)_ | "find the reserve" capture _(Day 7)_ |
| OutLayer TEE (Intel TDX) | The checker: sealed settings, Hyperliquid reads, attested execution | `checker/` _(Day 3–5)_ | attestation hash on Verify _(Day 8)_ |
| OutLayer custody wallets + policy | One wallet per guard; its keystore pays only the owner's Hyperliquid address, capped at one rescue | `checker/` wallet open, `contracts/guard-registry` policy _(Day 2–3)_ | mainnet refusals of an unlisted recipient and an over-cap amount _(Day 3)_ |
| NEAR contract | Guard registry: hashes of the owner and the account, status, rounded receipts; controls each guard wallet's policy and the owner's freeze | `contracts/guard-registry` _(Day 2)_ | contract tests; testnet deploy _(Day 2)_ |
| NEP-413 signatures | NEAR wallets own guards and sign freezes, verified on chain | `contracts/guard-registry` _(Day 2)_ | signature tests _(Day 2)_ |
| NEAR AI Cloud | Private copilot: plain English → reserve size and defence line, with attestation and signed answers | `apps/web` copilot route _(Day 9)_ | attestation check _(Day 9)_ |
| NEAR AI Agent Market | Agents hire and fund a guard through the MCP tool | MCP tool _(Day 11)_ | sample agent run _(Day 11)_ |
| Trezu | The make-good fund is a public 2-of-3 multisig treasury: every payout is a voted payment request anyone can see (three founder-held keys on separate devices for now) | ledger fund line _(Day 8)_ | the treasury's members, votes and payouts _(Day 8)_ |
| Rhea Lending | The fund's USDC earns between claims, supplied through Trezu's Earn section | ledger's Rhea views _(Day 8)_ | Rhea `get_account` of the treasury _(Day 8)_ |
| Chain signatures _(P2)_ | One reserve also defending Aave positions on Base/Arbitrum | — | — |

## Trust model and honest limits

See `docs/ARCHITECTURE.md` §2. In short:
- **The AI never touches money:** it proposes settings; sealed code decides and can pay only you. A test proves no AI output can change where a rescue goes.
- **Guaranteed:** nobody can read your defence line or reserve size. A rescue can only pay your own Hyperliquid account, and a close only pays an address you signed for. You can freeze your reserve with one signature, even if Ripcord disappears.
- **Not hidden:** your Hyperliquid positions and liquidation price, which are public by design, and the fact that USDC arrived. Which accounts are guarded isn't public: the registry stores only hashes, and receipts show the hour and a rounded amount.
- **Early rescues:** about 2 in 3 rescues end with the price bouncing. Your position is never touched, the USDC stays yours as margin, and you pay only the network fee.
- **Speed:** a rescue takes about 45 s end to end, so a move that crosses your buffer faster than that can still liquidate you. MVP protects cross-margin positions.
- **Third parties:** OutLayer (keys, one custody wallet per guard, liveness), Confidential Intents validators and TEE bridge, and 1Click solvers for price.
- **Isolated positions:** need one approval of a Hyperliquid agent held in your guard's wallet. It can't transfer or withdraw your money; on Hyperliquid an agent could trade or deposit into vaults, so Ripcord's code only ever signs "add margin". Revoke it any time.
- **Our promise:** if a guard fails because of us, we pay back what the liquidation took (up to the reserve at the time or $10,000) from a public make-good fund fed by 10 % of every save fee: a Trezu multisig treasury where every payout needs 2 of 3 keys. For the hackathon all three keys belong to the founder, on three separate devices: a stolen or lost key can't pay out, but this doesn't yet protect the fund from us. Independent key-holders come next that earns on Rhea Lending between claims. Eligibility is checked from your seal file and public prices; see `docs/ARCHITECTURE.md` §9.

| Who | Can see | Can't see |
|---|---|---|
| Public and hunters | Positions and liquidation prices (public on Hyperliquid), and that USDC arrived | Your line, your reserve, what's left, or whether you're guarded |
| Ripcord's team | Which accounts are guarded (the pokers need them) | Your line, target or reserve |
| OutLayer's operator | Your reserve's balance, and each rescue's amount and destination | Your line and target (sealed in the enclave) |
| 1Click | Each swap's amount and destination | Your line, or the rest of the reserve |
| Confidential Intents' operators | To confirm | — |

## What we hit _(Day 12)_

Real problems from building on mainnet and how we fixed them, e.g. OutLayer's storage estimate running short, NEAR Intents' private route going down for minutes during its confidential rollout, and the guard pausing rather than rescuing publicly.

## Prior art

| Project | Difference |
|---|---|
| Chainlink CRE liquidation-protection challenge (Sept 2026) | Private rules for a testnet loan, but each public action reveals the strategy; Ripcord's reserve is unlinkable and its line is redrawn per rescue |
| Synthetix Wick Insurance | Grace period inside one venue; needs the venue to build it |
| DeFi Saver Liquidation Protection | Lending positions, one chain at a time, public; nothing for perps |
| Liquidation heatmaps (OpenMarket, MMT, Hyperdash) | The hunter's tools; Ripcord is the counter |
| near.com confidential perps | Hide who trades; positions and liquidation prices stay public |

## Business model

Ripcord is paid only when it saves you: 3 % of the rescued amount (0.5 % above $50K) when the price later crosses your old liquidation price, proven on a public receipt, plus $1 a month per guard. An early rescue costs only the network fee (~$0.32).

Priced on live Hyperliquid positions (Oct 22 2026, $12.0B open interest; method in `docs/EVIDENCE.md`): if every position within 60 % of liquidation were guarded, save fees would be about $11M a year, or $17M with 2× reserves. 70 % comes from $100K–$10M positions, mostly in accounts outside the 1,500 largest; positions under $100K are 62 % of guards but 7 % of fees. Guarding 5 % of those positions is about $0.5–0.8M a year.

Beyond save fees:
- **Order flow:** hidden stops and the fast lane place orders, which can carry a Hyperliquid builder fee (up to 0.1 %, approved once by the user). Third-party apps earn about $100M a year this way.
- **Distribution:** front ends earn on every trade, and a liquidated trader often stops trading. They embed the guard and share the save fee.

## What's next

- **Fast lane:** opt-in reduce-only orders from the attested code when a move is faster than a rescue can land.
- **Hidden stops:** stop-loss and take-profit sealed in the enclave, never resting on Hyperliquid's public book.
- **Self-firing ladder for shorts:** confidential limit orders that pre-place rescues and fire even while Ripcord is offline. Designed, and tested up to funding; it switches on when 1Click limit orders can pay Hyperliquid (today they pay Arbitrum, Ethereum or a confidential balance).
- **Lending positions:** the same hidden reserve adding collateral to an Aave position (`supply(onBehalfOf)`) or a Rhea Lending position instead of selling it. Rhea credits every deposit to its sender today; the change it needs is small: a deposit that names the account it credits.
- **near.com perps:** near.com gives each user a dedicated Hyperliquid account with cross margin, so a guard can defend it unchanged: EVM users trade from their own address, others from a trading-signer key they can export.

## Repository layout

```
apps/web                 Next.js app (App Router, Tailwind v4)
packages/shared          Types, JSON schemas, commitment + guard logic (shared by web and poker)
services/poker           Watches public Hyperliquid state; asks the checker to check guards near liquidation
contracts/guard-registry NEAR contract: guard registry and wallet-policy controller (Rust)
checker                  OutLayer TEE program: sealed guards, Hyperliquid reads, rescues (Rust → WASI P2)
docs                     Architecture and trust model, interfaces (SPEC), design, evidence
```

## Built with

Libraries and tools are listed here as they are added (HACKATHON.md Q-005): _(Day 1)_.

## License

MIT
