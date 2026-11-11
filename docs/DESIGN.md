# Ripcord — Design (v3: Vault)

Design is a scored criterion. Treat it as a feature, not leftovers.
Chosen Oct 21 2026 from three directions (canvas "Ripcord Directions": A Terminal, B Calm, **C Vault**). Every screen is drawn on the canvas "Ripcord Product" (revised Oct 21 for pay per save, isolated margin and guard health); this file is its written spec, so a change to one goes into the other.
## 1. Concept: the guard is a card

A guard is an object you own, shown as one premium card, the way a bank card is. Its texture is a **guilloche rosette generated from the guard's fingerprint**, like banknote security printing: no two guards look alike, and the same rosette appears wherever that guard does. The card shows what's yours and safe to show (position, distance from liquidation, status); what's sealed (reserve, rescue range) shows as `••••••`.

Beside it sits **what a hunter sees**: the same position as Hyperliquid shows it to everyone, with the liquidation line drawn in red. The product is that contrast: a public target, and a defence behind it nobody can see.

Rules of the look: quiet, a lot of space, one bold object per screen, very few words; dark is the signature, light its daylight twin (§2). Amber means *guarding*, red means *the public liquidation line*, green means *a rescue landed*. Nothing else gets colour. No gradients, no glow, no decorative chips or eyebrow labels.

## 2. Tokens

Two themes from one set of tokens: dark is the signature look, light its daylight twin. The app follows the system setting, with a toggle. **The guard card stays dark in both**, like a metal card on a desk: it is the one bold object and its rosette is drawn for a dark ground, so on the card every token keeps its dark value. The light values are drawn on the Product canvas (Oct 25: a light twin of every screen; the homepage's closing band uses the card's material, so it stays dark too). Judge them there before the Day 10 design pass.

### Colour
| Name | Dark | Light | Use |
|---|---|---|---|
| Ground | `#09090B` | `#F7F7F5` | Page background |
| Panel | `#111114` | `#FFFFFF` | Side panels (hunter view, forms) |
| Card | `#131316` | `#131316` | The guard card, dark in both themes |
| Line | `#1F1F24` | `#E6E6E2` | Hairlines, panel borders |
| Line 2 | `#26262C` | `#26262C` | Card border |
| Line 3 | `#2E2E35` | `#D1D1CC` | Ghost buttons, chips |
| Text | `#F4F4F5` | `#0B0B0D` | Primary text, primary button fill, price line |
| Text 2 | `#D4D4D8` | `#3F3F46` | Secondary values (card labels keep the dark value) |
| Muted | `#A1A1AA` | `#52525A` | Secondary text (≥ 7:1 on ground in both); the dot for a close call or an unguarded position |
| Rosette | `#3A3A44` | `#3A3A44` | Rosette strokes, on the card |
| Amber | `#E8A33D` | `#9A5B00` | Guarding: the card's status chip, the health line, guard badges, a rescue still settling; inner rosette, focus ring |
| Red | `#F06459` | `#C2362B` | Public liquidation line, a paused guard, errors; distance bars under 5 % |
| Green | `#4CC38A` | `#1D7F52` | Rescue landed, a save, verified ticks |

Light values were picked for contrast on `#F7F7F5`: Text 2 9.7:1, Muted 7.2:1, Amber 5.1:1, Red 5.1:1, Green 4.7:1.

### Type
- **UI and display:** Geist 400/500/600/700 (Google Fonts, via `next/font`), chosen Nov 8 over Instrument Sans (an overused default) after side-by-side renders of the hero and the dashboard: crisp tabular figures and the look of a current trading tool. Display headlines 600, tracking −4 % (the floor), line-height ≈ 0.95. Sentence case.
- **Machine strings only** (addresses, fingerprints, masked values): Geist Mono 400, letter-spacing 0.16–0.2 em for card-number style.
- Scale: 13 · 15 · 17 · 20 · 28 · 36 · 48 · 56 · 76 · 112. The website's hero is 112 and its section headlines 56 (60 and 36 on phone); snap the canvas's in-between sizes (24, 30, 44) to the scale when building. Numbers that change use `tabular-nums`.

### Shape and space
- Radius: guard card 28 (22 on phone), panels 20, buttons and chips 999.
- 4 px grid; generous: section gaps 40–56 px, card padding 32 (20 on phone).
- The card keeps the bank-card ratio **1.586 : 1**.

### The rosette
SVG strokes (Rosette colour, 0.7 px; inner ring in Amber at 55 %), deterministic from the guard's commitment hash (petal count, phase, amplitude from hash bytes), centred toward the card's lower right so it is partly cropped. Same function everywhere: card, verify page, seal file icon, favicon, OG image. Renders without JS.

## 3. Layout

Website: max width 1240 px, left-aligned; the hero puts the headline on the left and the card, laid over "what a hunter sees", on the right. App: max width 1360 px; on Guard, "what a hunter sees" takes the wide column and the card with its sealed settings the narrow one, and the rescue history runs full width below. Phone: one column, the card first, the main action at the bottom above the tab bar (Guards · Ledger · Verify).

```
Ripcord   Guards  Ledger  Verify                                    0x9c4e…41f2

ETH long · 10× cross             Top up reserve · Change range · Freeze reserve
● Guarded · checked 41 s ago

What a hunter sees                               ┌────────────────────────────┐
Mark 2,411.80  Liq ─ 1,995.10  17.3%             │ ETH long · 10×   ● Guarded │
┌──────────────────────────────────────┐         │                            │
│ ~~~~~~~~~~~~~\        /~~~~~~~~~~~~~ │         │ 17.3%            (rosette) │
│               \●     /               │         │ from liquidation           │
│ ──────────────┐\_●_/                 │         │                            │
│               └───┐                  │         │ 7F3A 91C2 ···· C91E •••••• │
│                   └───────────────── │         └────────────────────────────┘
└──────────────────────────────────────┘         Sealed settings   Hold to peek
Rescue history: when · margin added · before → after · landed in · outcome · proof
```

## 4. Screens
1. **Home** (website, desktop and phone), top to bottom:
   - Hero: "Hidden margin.", one sentence, **Guard a position** · **Try to hunt it**, and the card laid over what a hunter sees. The card is a 3D object (it turns toward the pointer, floats when idle, shows its edge, and its rosette prints on load); what a hunter sees is live: the real Oct 10, 2025 ETH crash (Binance 1-minute bars, the replay harness's own fixture) through the guard's real rules, a 10× long opened at 21:00 UTC that an unguarded position loses at 21:16:37 and the guard keeps, at 20× speed and 4× while a rescue is in flight and for the beat after it lands. It opens two seconds before the first rescue fires, marks "Liquidated here without Ripcord" where the unguarded position dies, and can be paused. The chart's price range is fixed for the run, so the red line itself slides away when a rescue lands and the old line stays dashed.
   - "This is the app.": the app's own Dashboard and Guard components on the example account, framed as a desktop window and a phone, arriving once out of focus into focus (600 ms), with **Open the example account** (`/guards?example`).
   - Four stats, each with its source and date, rendered with their real values (no count from zero in the HTML): 27–46 s (mainnet test rescues, Oct 21), 0 of 53 (BTC 10× longs liquidated in the Oct 10, 2025 crash replay, Balanced with the speed-aware trigger and a 1× reserve; 53 of 53 without a guard; `crates/replay`), 35+ (chains a reserve can come from), $0 (Ripcord's fee when a rescue doesn't save you).
   - "Your liquidation price is public.": an illustrated stack of liquidation levels in shallow 3D, rising when seen, yours in red.
   - **"How NEAR keeps it hidden."**: the rescue's path from your device to your margin, one step per NEAR piece — OutLayer seals the line, NEAR Confidential Intents hides the reserve, NEAR Intents moves it to Hyperliquid in under a minute, a NEAR contract holds the rules and the owner's freeze — each with the code or testnet transaction that proves it; a rescue travels the path once when it scrolls into view. The hero names the three pieces under its actions ("Runs on NEAR"), and the nav links here.
   - **"The edge, right now."**: the five largest positions near liquidation in a scan of public Hyperliquid data (the 1,500 largest accounts, addresses left out), each with a distance bar, red under 5 %. On Oct 21 every position within 5 % was isolated. Re-run the scan (`scripts/scan/edge.py`) before the video and the submission, and keep its date on screen.
   - Three steps: Seal, Fund, Guarded; an isolated position takes one approval on Hyperliquid first.
   - **"Try to hunt it."**: the Hunt simulator (screen 5), on the page.
   - **"Pay for saves, not alarms."**: $0 for a close call, 3 % for a save, $1 a month per guard (the headline names the monthly charge so it never contradicts it).
   - "Built so you don't have to trust us.": Pays only you · Nobody can link it · A line nobody can learn · Code you can check · Freeze it yourself · We pay if we fail; each links the file or test that backs it.
   - Five questions (the first: why not just add margin or run a bot), five questions, the closing band "Your line is public. Your defence isn't.", and a footer with the product and the proof (source, evidence, architecture).
2. **Guards** (dashboard) — a summary row (account value, guarded notional with "3 of 4", reserve `••••••`, rescues in 30 days and how many saved, median rescue time); every position with its guard (Guarded, Guarded · isolated, or a **Guard** button), nearest to liquidation first, with its margin, and distance bars amber under 10% and red under 5%; beside them the selected guard's card, its health line, what a hunter saw today and recent activity. One line of evidence at the foot: "Watching prices every 3 s · enclave last checked 41 s ago · guard build 4e1d9a7 · verified".
3. **Guard** — what a hunter sees (mark, public liquidation, distance, the chart with rescues marked) beside the card and its sealed settings (Hold to peek). **Show my band** draws the owner's sealed rescue band on the chart, in prices, and the title becomes "What you see". Actions: Top up reserve · Change range (marked Current, each choice as the price it steps in near) · Freeze reserve · Close guard, the money-moving ones paused while a rescue is in flight, with the reason; one inline panel at a time (Escape closes): each works on the example account, and on a real guard says what it will do until it arrives with mainnet. Frozen, a crash can't be tried and the chip turns red: Frozen. The dashboard's Reserve holds to peek, and the account pill opens a menu (copy address, view on Hyperliquid, disconnect). Under the title, the health line "Guarded · checked 41 s ago"; when checks stop, the paused banner (§5) takes its place and the card's chip turns red: Paused. Rescue history: when, margin added, distance before → after (shown only to the owner), landed in, outcome (Saved and its fee · Settling and the time left · Close call, no fee), proof, and **Publish proof** for any rescue (§5).
4. **New guard** (set up) — a price ladder shows where the guard steps in, in prices, between the price now and the public liquidation price, and each choice is named by the price it steps in near; a step strip, there from the start, shows where you are and what's left: Set it up · Seal · Save seal file · Approve on Hyperliquid (isolated) · Fund reserve. Then position (cross needs no approval; isolated takes one on Hyperliquid) → describe in plain words → read back → **Seal** → fund. The read-back puts the **reserve first** (asset, amount, how long; its size against the position's margin, the replay result at 2× and a one-tap "Use 0.078 BTC"), then **when to step in**: Safer, Balanced or Lean, each with its replay figures (share liquidated, early rescues a month). The choice marked for you follows the replays at this reserve: the lowest share liquidated, then the fewest close calls (Nov 8; it replaced "Lean at ≥ 1.5×", which could mark the one choice with a non-zero liquidation rate), with the reason said under the choices. **Seal it** says what sealing does (encrypted on this device, handed to the enclave, nothing on chain and nothing paid until the reserve is funded); the passphrase is named for what it locks, with one line on the seal file you save next; signing with a NEAR wallet instead is one optional checkbox with its privacy cost said beside it; a **Before you seal** box holds the pasted-account confirmation and the honesty and fee lines (§5); under **Seal guard**, why it's blocked, or what comes next. After it: "Sealed. Now save your seal file." A live preview of the card sits beside the steps and seals itself at the end. Until the copilot (plain words) arrives, the steps start at the read-back. After the seal: save the seal file (the next step waits for it), the approval if isolated, then fund. Any guard a person leaves half set up finishes on Guard. Connecting asks for nothing to be signed; pasting an address works too, and only an isolated guard's approval needs the wallet. A cross guard covers every cross position on the account, since they share one margin balance. On an example account, Guard also offers **Try a crash**: the rescue moment through the guard's real rules on simulated prices.
5. **Hunt** — the simulator: chart, two buttons, four inline figures, a short public feed, reveal at the end (the sealed lines drawn where they were, and which sale would have liquidated the position with no reserve). One sale per 3 s while the book refills; tested to hold on every seed (`apps/web/test/hunt.test.ts`).
6. **Verify** — guard id + seal file → the card opens → three ticks: the settings match the seal; every rescue fired inside its drawn range, with each one's outcome; the guard runs the published code. Then **Our promise**: "No liquidation on this guard", or after a liquidation the answer to the compensation question: "Eligible: your line was crossed at 14:03:21 while guarded; no rescue fired." or the plain reason it isn't.
7. **Ledger** — public totals (rescues, saves, margin added, median time to land, slowest 5 %); the make-good fund line (balance, 10 % of every save fee, where it earns at the live rate, e.g. "earning 10 % a year on Rhea", paid out, a link to its Trezu treasury, where anyone sees its members, votes and payouts); then every rescue: the hour, a rounded amount, latency, outcome (**Saved**, **Settling** or **Close call**, settled 24 h after landing), the guard's fingerprint and its receipt. Hyperliquid and NEAR links appear only where the owner published proof; Ripcord's own guards always do. No account, distance, range or reserve.

## 5. Copy rules
- Name things by what users understand: "Guard", "Reserve", "Rescue range", "Rescue", "Seal file". Not "intent", "TEE", "attestation", "confidential shard" in primary UI. NEAR's pieces are named, by their product names, where each one does its work and in a secondary line ("Sealed on this device to OutLayer's enclave on NEAR"): the app says how NEAR solves the problem without making a trader learn the words first. The Guard page's **On NEAR** panel lists this guard's line, reserve, rescue, record and freeze, each with its NEAR piece and a link.
- Few words. A screen gets one headline and at most one sentence under it.
- Buttons say what happens: "Seal guard", "Fund reserve", "Close and return 0.05 BTC". A button and its toast use the same verb.
- States: Sealing… → Waiting for reserve → Guarded → Rescuing… → Rescued → Settling (up to 24 h) → Saved or Close call → Closed. Off the happy path: Guard paused ("Checks stopped at 14:02. Your reserve is safe, but your position isn't protected until they resume."), or Rescues paused when the private route is down ("Rescues paused: the private route has been down since 14:23 (NEAR Intents). Your reserve is safe, but your position isn't protected until it's back."). A receipt's `outcome` reads: `pending` → Settling, `saved` → Saved, `early` → Close call, `failed` → Liquidated ("Liquidated. The price fell past the margin this rescue added. Verify says whether our promise covers it.").
- Rescue outcomes, said plainly. Saved: "Saved. BTC fell past your old liquidation price ($91,139). Your reserve had moved it to $87,676, 38 s earlier." Close call: "Close call. BTC came within 3.1% of your old liquidation price. The $342 is still yours, as margin. No Ripcord fee."
- Errors explain and direct: "Reserve not seen yet. BTC deposits need 1 confirmation, usually 10 minutes." No apologies.
- Honesty line on set up: "A rescue takes under a minute. A move faster than that can still liquidate you."
- Money, in the same words everywhere. Set up: "No Ripcord fee unless a rescue saves you, then 3% of it · $1 a month · about $0.32 network cost per rescue". Guard: "Ripcord charges only for saves: 3% of that rescue, 0.5% on any part above $50,000. A close call costs only the network fee."
- Margin type, said once, under the position. Cross: "Cross margin, so no approval is needed. An isolated position takes one approval on Hyperliquid, so a rescue can reach it." Isolated: "Isolated margin, so this guard needs one approval on Hyperliquid. Its code only adds margin."
- The promise: "If a guard misses because of us, our make-good fund pays back what the liquidation took, up to your reserve or $10,000, whichever is lower."
- Frozen, said plainly: "Reserve frozen. Nothing can leave it, rescues included, until you unfreeze it. Its balance shows again when you do." (While frozen, OutLayer won't even read the balance.)
- Ledger privacy, one line under the table: "Times are to the hour and amounts rounded, so a rescue can't be matched to an account. Owners can publish full proof." On Guard, **Publish proof** explains itself: "Shows this rescue's exact time, amount and Hyperliquid transaction on the public ledger. Anyone could then link it to your account."
- Every number on a public page names its source and date: "Mainnet test rescues from a hidden reserve into Hyperliquid margin, Oct 21"; "Public Hyperliquid data, the 1,500 largest accounts by value, Oct 21, 2026. Addresses left out."; "Replay of ETH 10× longs and shorts held a week, Oct 2025 to Sep 2026". A speed is the measured range, never the best case alone. Example data says so ("Example data until launch"). In the UI a percent sign touches its number (9.3%).

## 6. Quality floor
Responsive to 360 px; both themes, following the system setting with a toggle; keyboard focus is a 2 px Amber ring; contrast AA in both themes (Muted on Ground ≥ 7:1 in each); `prefers-reduced-motion` turns every signature moment into a 120 ms cross-fade to the same end state.

## 7. Demo video (≤ 2 min, made for the grand prize)
The hackathon's own rules for a demo (HACKATHON.md, "A good demo post"): lead with the user problem, in a first line anyone understands; show **one complete moment**, a real user action going to a visible result; say concretely what NEAR enables; end with a next step and a genuine question. So: no title card, no architecture slide, no sped-up setup. NEAR's pieces appear **inside the story, at the moment each one does its work**, as callouts on the real screens, never as a diagram. One guard is shown end to end; both margin types are explained.

Production:
- **One visual language.** Every graphic is the app's own component (the card and its rosette, the liquidation stack, "The edge, right now", the NEAR path, Verify's envelope), played as a scripted sequence on a `/film` page at 1920×1080. Nothing from a stock library and no slides, so footage and graphics cut together without a seam.
- **The real moment is real.** The rescue beat is a mainnet screen recording, **unedited and in real time**, with a clock in frame (Hyperliquid on the left, Ripcord on the right). The film page plays it as recorded, without cuts or speed-ups.
- Captions burned in (X autoplays muted), one idea per beat, every number real and dated, the replays labelled as replays, no individual named, no jargon in a caption that a NEAR callout doesn't explain. A 16:9 cut for the submission and a 30–40 s vertical cut for X (beats 1, 4, 5 and 9).

| Time | Beat | On screen | Caption · NEAR callout |
|---|---|---|---|
| 0:00 | 1. The problem | A real Hyperliquid position, its liquidation price in red; the stack of other traders' liquidation lines rising behind it | "On Hyperliquid, everyone can see the price that liquidates you." |
| 0:05 | 2. The hunt | The Oct 10, 2025 ETH crash from the hero: price driven into a cluster of lines; the unguarded position dies at 21:16:37 | "Traders push the price to those lines. $3.21B was liquidated in one minute on Oct 10, 2025 (Kaiko)." |
| 0:12 | 3. The guard | The card lands over the same position and its rosette prints | "Ripcord adds margin before the liquidator gets there, from a reserve nobody can see." |
| 0:18 | 4. Sealed | The real seal moment: the values collapse to `••••••`, a fingerprint types in | "The line is sealed on your device to a TEE." · **OutLayer on NEAR**: the guard runs in an enclave; not even Ripcord can read the line. |
| 0:26 | 5. Hidden reserve | The fund step, then the card's reserve `••••••` | "The reserve sits where no one can size it." · **NEAR Confidential Intents**: private balance, funded from 35+ chains. |
| 0:34 | 6. The moment (unedited, clock in frame) | Split screen. Margin is pulled from the real position, the distance falls past the hidden line, the guard fires; about 20 s later USDC lands, Hyperliquid's red line slides away, the card turns green: Rescued | "We pull margin to push a real position toward liquidation. Mainnet, unedited." · **NEAR Intents**: moved the reserve into the Hyperliquid account in about 20 s. |
| 1:04 | 7. Cross and isolated | Cross: the one guard covering every cross position (as filmed). Isolated: "The edge, right now", every position within 5% isolated, then the one approval on Hyperliquid | "Cross margin: one guard covers every position. Isolated: one approval, and the guard's own key can only add margin, never withdraw." |
| 1:16 | 8. Proof, without the account | The rescue on the Ledger (the hour and a rounded amount), its NEAR transaction, Verify's veil sliding off and three ticks, then Freeze | "On chain: an hour and a rounded amount, never the account. Verify it. Freeze it with one signature." · **A NEAR contract** holds the rules, the record and the owner's freeze. |
| 1:30 | 9. Tested blind | 211 → 20, counted down over the October holdout | "Predictions sealed before the prices existed: 211 of 992 liquidated without a guard, 20 with one." |
| 1:38 | 10. Next step | The card, the link and the repository | "Your line is public. Your defence isn't. Traders: how far from liquidation would you hide your line?" |

The agents track gets its own 20-second clip only if the agent tool ships; otherwise the agents are a roadmap line in the README.

## 8. The breathtaking bar

One bold object per screen, everything else quiet and exact. Expressive motion only in these four moments, plus Home's live hero and Hunt, which are the rescue moment running continuously. Sections don't fade in on scroll: content is visible as rendered.

### 8.1 Signature moments
| Moment | What happens |
|---|---|
| **The seal** | On **Seal guard**, the rosette prints itself onto the card (strokes draw in, 600 ms), then each sealed value collapses into `••••••` (120 ms, staggered), then the fingerprint types in, one character per frame. |
| **The card** | Every guard's rosette comes from its own hash. The same card appears on Home, Guards, Guard, New guard, Verify, the seal file icon and the share image. |
| **The rescue** | On the hunter side the red liquidation line slides away from price (420 ms, the number ticks with tabular digits); on the card the distance counts back up and the status chip turns green "Rescued" for one beat, then back to amber. |
| **Opening the envelope** | On Verify, a dark veil slides off the card at −12° (600 ms), the sealed values appear, and three ticks land 120 ms apart. |

Motion tokens: `--dur-1: 120ms`, `--dur-2: 240ms`, `--dur-3: 420ms`, `--dur-4: 600ms`; `--ease: cubic-bezier(.2,.8,.2,1)`.

### 8.2 Craft checklist (every screen, Days 10–11, at 360 and 1280, in both themes)
- [ ] **Holds up beside the best.** Put the screenshot next to Phantom, Linear, Mercury and Hyperliquid at the same size. If it looks like a hackathon project next to them, it isn't done.
- [ ] **One bold object per screen.** If two things compete for attention, one of them goes.
- [ ] **Few words.** One headline, at most one sentence under it. No eyebrow labels, no decorative chips.
- [ ] **Type:** tight display headlines; tabular numbers everywhere numbers change; `text-wrap: balance` on headlines, `pretty` on body.
- [ ] **No layout shift:** numbers reserve their width; fonts preloaded with fallback metrics.
- [ ] **Every state designed:** empty (one sentence + one action), loading (skeleton with final geometry), error (§5), success. No raw error strings, no `undefined`, no `NaN`.
- [ ] **Real data only where it matters:** one position, real-looking amounts; nothing that looks like filler.
- [ ] **Interaction:** hover, active, focus-visible and disabled states; 44 px touch targets; Escape closes overlays.
- [ ] **AA contrast** verified with a tool.

Score each screen 0–5 against this list; below 5 means another pass.
