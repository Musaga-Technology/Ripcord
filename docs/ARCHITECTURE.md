# Ripcord — Architecture (v2: hidden margin)

Every endpoint and field below was read or measured on Oct 21 2026 (`docs/RESEARCH_NOTES.md` § v2). Re-verify before coding.

## 1. Components

```
┌──────────────────────────┐        ┌───────────────────────────────────────────┐
│ apps/web (Next.js)       │        │ OutLayer (Intel TDX enclave)              │
│ - connect (EIP-191/413)  │──HTTPS▶│ checker/ (Rust → wasm32-wasip2)           │
│ - positions (public API) │        │  actions: pubkey · create · check ·       │
│ - set guard · seal · fund│        │           close · reveal-verify           │
│ - hunter's view · ledger │        │  - encrypted storage: sealed guards       │
│ - hunt simulator · verify│        │  - HTTPS: Hyperliquid info, custody API   │
└────────────┬─────────────┘        │  - one custody wallet per guard (reserve) │
             │                      │  - host call(): registry writes           │
             ▼                      └──────┬──────────────────────┬─────────────┘
┌──────────────────────────┐   call        │ custody withdraw     │ HTTPS (read)
│ contracts/guard-registry │◀──────────────┤ (policy-checked)     ▼
│ guard: owner + account   │               ▼              ┌─────────────────────┐
│ hashes, commitment,      │  ┌────────────────────────┐  │ Hyperliquid info API│
│ status, receipts, policy │  │ NEAR Intents / 1Click   │  │ clearinghouseState  │
└────────────▲─────────────┘  │ reserve: confidential   │  │ metaAndAssetCtxs    │
             │ view           │ balance (intents.far)   │  └─────────▲───────────┘
┌────────────┴─────────────┐  │ → USDC credited to the  │            │ public poll
│ services/poker (Node)    │  │   owner's HL perps      │────────────┘
│ polls public HL state;   │  │   balance (~45 s)       │
│ calls checker inside band│  └────────────────────────┘
└──────────────────────────┘
```

- `contracts/guard-registry` is written on Day 2. No NFT in MVP.
- Shared types live in `packages/shared` and are mirrored by hand in Rust (`checker/src/types.rs`, contract `Guard`). Golden-vector tests keep `commitment.ts` ↔ `commitment.rs` and `guard.ts` ↔ `guard.rs` in lockstep.

## 2. Trust model (README carries this table)

| Party | Can | Cannot |
|---|---|---|
| Ripcord team / deployer | Ship a new checker build (new **code hash**, visible on the verify page); change the web UI; upgrade the registry contract during the hackathon (it controls the wallet policies; locked or handed to a DAO after); see which Hyperliquid accounts are guarded (the pokers need them) | Read your defence line or reserve size; move the reserve anywhere but your own Hyperliquid account or your close address; loosen, delete or unfreeze your wallet's policy without your signature (once the registry is locked) |
| Guard owner (you) | Freeze or unfreeze your reserve's wallet with one signature, even if Ripcord is gone; approve policy changes; close to an address you sign for | — |
| OutLayer operator | Stop workers or the custody API (liveness: no rescues while down); its coordinator, outside the TEE, builds the 1Click transaction for each custody withdrawal, which the keystore signs after pinning the recipient (OutLayer's documented "trusted" step); see each guard wallet's confidential balance and each withdrawal's amount and destination (its coordinator serves them) | Extract keys or read sealed storage (TDX); log in to a guard's wallet without the checker's key |
| 1Click / solvers | Quote a worse price for a rescue (bounded by `slippageTolerance`); see a rescue at execution; 1Click, as operator, can link the reserve account to the credit (its quote holds the signer and `refundTo`) | Change a quote's recipient or token after the deposit (the deposit address is bound to the quote) |
| Confidential Intents (validators + TEE bridge) | Order and settle confidential transfers (what its operators can see of balances: to confirm) | Link a rescue to the reserve publicly ("deposits and withdrawals cannot be tracked to each other"; verified on the NEAR chain in G2) |
| Hyperliquid observers / hunters | See your positions, liquidation price, and that USDC arrived | See your defence line, your reserve's size or asset, or what remains after a rescue; tell from public data which accounts are guarded (rule 6), though a deposit near liquidation invites a guess |
| Poker | Ask for checks | Trigger a rescue (the checker fetches Hyperliquid state itself and compares with the sealed line) |
| Isolated-position agent (the guard wallet's EVM key, after your one approval; only isolated guards' wallets may sign EVM data) | Add margin to your isolated positions, the only action Ripcord's code signs; on Hyperliquid an approved agent could also trade or deposit into a vault (≥ $5) for your account | Transfer or withdraw your money (G8: refused). Closing the guard asks you to point it at a dead address; you can revoke it on Hyperliquid at any time |
| Ripcord checker offline | Delay rescues until it is back (liveness) | Move or reveal the reserve. (P1, §4.3b: once 1Click pays orders to Hyperliquid, a resting confidential ladder keeps firing for shorts while the checker is down.) |

**Key design rules**
1. **Pay-to-self only.** A rescue is one custody call on the guard's own wallet, `POST /wallet/v1/confidential/withdraw {chain: "hypercore", to, amount, token}`, with `to` = the guard's registered Hyperliquid address and `amount` ≤ the remaining budget, both from sealed settings, never from input. The wallet's on-chain policy whitelists only that address, the owner's close address and Ripcord's fee wallet, and caps each transaction at `max_rescue_usd`, so OutLayer's keystore refuses any other recipient or a larger amount even if the checker were compromised: allowlists and per-transaction caps are checked inside its TEE on every signature, while its daily and monthly limits depend on the coordinator's database, so we don't rely on them (G9, Oct 22: on mainnet the keystore refused an unlisted recipient and an over-cap amount from the real withdraw endpoint; confidential operations need the `confidential` transaction type). Verified on mainnet in G7 (Oct 21): 4.79 USDC from a per-guard custody wallet credited on Hyperliquid 33.6 s after the checker's call returned. The direct-signing path stays the reference for reserves outside custody (G2/G3: the checker fetches the quote itself, verifies the exact single `transfer` to its deposit address, re-composes it with its own ≤ 30 min deadline and a live nonce salt, signs for `intents.far` when confidential; 1Click accepted enclave-composed intents). A close pays only to an address the owner signed for.
2. **Each guard's reserve lives in its own OutLayer custody wallet, opened only by the attested checker.** The checker's signing key (`bind: project`) opens a deterministic wallet per guard (`wallet_id = f(checker account, guard_id)`) and logs in with `Bearer near:` tokens it signs inside the enclave (raw ed25519 over `auth:<seed>:<ts>`); a token never leaves the run and nobody stores per-user keys. No funds ever sit on the signing key itself (OutLayer: "Do not hold funds on a signing key": funds there are outside every wallet policy and are lost with the project). Verified in G7. Least privilege: policy capabilities are default-deny, so only isolated guards' wallets get `evm_sign` (with `raw_tx` off); a cross guard's wallet can't sign EVM data at all. P1: a delegate key for the owner's own wallet, sealed to the owner's receipt key, as an escape hatch.
3. **The checker never trusts the poker's numbers, or any input.** It reads `clearinghouseState` itself over HTTPS inside the TEE. With OutLayer's default `caller: "signer"`, any contract the owner transacts with can start a run under the owner's key with input it chooses, so the checker's manifest admits HTTPS calls only (`"callers": {"direct": "deny", "contract": "deny"}`, verified with probe v4), every ungated version is removed (`remove_version`: all published versions stay callable by `version_key`), and recipient, amount and deadline always come from sealed settings and the checker's own requests.
4. **Output reveals only `guarding | rescued | pending | skipped`.** Never distance, line, or reserve.
5. **Unlearnable line.** A hunter can watch *when* USDC arrives on Hyperliquid, so a fixed line would leak after the first rescue. The owner seals a *range*; the checker draws a fresh trigger point and top-up target from it with enclave randomness each time the guard re-arms. Public receipts never include distance. Watching rescues teaches a hunter nothing stable.
6. **No public link between a guard and its account.** The registry stores salted hashes of the owner and of the Hyperliquid address, never the values (§3). The wallet policy that lists the address is encrypted by OutLayer's keystore before it reaches the chain, so no transaction argument carries the address. Pokers learn addresses from the app over HTTPS, off chain (§4.1). Public receipts show the hour and a rounded amount; the exact time, amount and Hyperliquid transaction appear only if the owner publishes them (Ripcord's own test guards always do). The owner reveals who they are on chain only to freeze, unfreeze, change the policy or close. So the public can't tell which accounts are guarded until a rescue lands, and then only by guesswork: hunting gets riskier for every position, guarded or not. It also keeps the account link that near.com perps hide.

**Attacks and controls** (Day 12 links each row to a test or a mainnet transaction in `docs/EVIDENCE.md`)
| Attack | Control | What remains |
|---|---|---|
| A rogue poker sends false prices or floods checks | The checker reads Hyperliquid itself (rule 3); the payment-key balance monitor (§8) | Cost, not funds |
| A stranger calls the checker over HTTPS with its own payment key | OutLayer derives a run's keys from its caller, so that run can't open any guard's wallet; actions never output settings (rule 4); no direct or contract callers (rule 3) | — |
| A compromised checker pays someone else | Keystore recipient allowlist (rule 1) | Ripcord's fee wallet is an allowed recipient: up to one cap per transaction could go there. OutLayer's limits are per token, not per recipient, so it can't have its own cap; the daily limit bounds a day while OutLayer's database is honest, and the make-good fund refunds |
| A compromised checker drains the reserve | Keystore per-transaction cap of one rescue (rule 1); the owner's freeze (§4.4b) | Repeated rescues still land only in your own margin |
| OutLayer's coordinator builds a wrong 1Click transaction | The keystore pins the recipient | Amount and token rest on OutLayer's documented trust |
| A login token is captured | Signed in the enclave, valid ±30 s, never stored (rule 2) | A 30 s window, on OutLayer's side |
| The isolated-position agent is misused | Add-only in attested code; `evm_sign` only on isolated guards (rule 2); a dead-address approval on close; Hyperliquid blocks agent transfers and withdrawals (G8) | It could trade or deposit into a vault until revoked |
| A hunter learns the line from rescue timing | Line and target redrawn inside the sealed ranges at every re-arm (rule 5) | — |
| A hunter lists guarded accounts | Hashes only, rounded receipts (rule 6) | A guess after a rescue |
| The copilot or an MCP agent is told to redirect a rescue | The recipient comes from sealed settings bound to the owner's account, never from AI output; the owner confirms every setting | — |
| Ripcord disappears or turns hostile | One-signature freeze and close through the registry; no policy change without the owner's signature (§4.4b) | Rescues stop until checks resume; until the registry is locked after the hackathon, its deployer could upgrade it |
| Owner signatures are replayed | Single-use nonces (§4.4b) | — |

## 3. Data model

### Guard (public, in registry)
```
guard_id: string            // "g-<base32 random 10>"
owner_commitment: string    // sha256(owner ‖ owner_salt); owner = EVM 0x (EIP-191) or the ed25519 public key that signs NEP-413 (a contract can't look up an account's keys); owner_salt = sha256(the owner's signature over "ripcord:owner-salt:v1"), so the app can find an owner's guards again without the seal file; `owner` is revealed only to freeze, unfreeze, change the policy or close
account_commitment: string  // sha256(hl_address ‖ account_salt); the address itself lives only in sealed settings, the encrypted wallet policy and the pokers' private lists (§2 rule 6)
commitment: string          // hex sha256(canonical(settings) || salt)
status: Pending|Guarding|Closed|Expired
created_at, expires_at: u64 // ns
rescues: Vec<RescueReceipt>
check_budget: U128          // yocto NEAR, reimburses pokers
```

### GuardSettings (sealed, only in TEE storage)
```
owner: string               // EVM 0x or NEAR account; matches owner_commitment
hl_address: string          // the Hyperliquid account protected (0x): the only rescue recipient
account_salt: string        // opens account_commitment for Verify and compensation evidence
line_range_pct: (Decimal, Decimal)   // e.g. (5.0, 8.0): trigger point drawn inside this range on every re-arm
target_range_pct: (Decimal, Decimal) // e.g. (9.0, 13.0): top-up target drawn inside this range per rescue
max_rescue_usd: Decimal     // per rescue
budget_usd: Decimal         // total across rescues
reserve_asset: string       // 1Click assetId, e.g. "nep141:btc.omft.near"
cooldown_s: u32             // wait for credit before the next rescue (default 60)
close_hint?: { chain, address }
```
Presets (copilot defaults, as fractions of the position's starting distance to liquidation D0): Safer line 0.75·D0 → target 1.10·D0, Balanced 0.60 → 1.00, Lean 0.45 → 0.90; the sealed ranges are drawn around them (rule 5). Timing follows the reserve: Lean when the reserve is ≥ 1.5× margin, Balanced otherwise.

### Reserve (per guard, never published)
The guard's OutLayer custody wallet, `wallet_id = UUID(sha256("outlayer:deterministic-wallet-id:" + checker_account + ":" + guard_id)[:16])`. Its confidential balance on `intents.far` is the reserve; its NEAR account never exists on the public chain when funded cross-chain (G7). Policy: recipients = {`hl_address`, close address, Ripcord fee wallet}; nothing else allowed; transaction type `confidential` only; per-transaction caps on USDC and on the reserve asset, at least 1Click's minimum (≈ $5) and `max_rescue_usd`; no approval block (G9). **Controller: the guard-registry contract** (decided Oct 21): it sends `store_wallet_policy` when the guard is created, so it becomes the controller, and it exposes only owner-signed freeze, unfreeze and policy updates (EIP-191 / NEP-413 verified on chain, §4.4b). Storage ≈ 0.01–0.02 NEAR per guard, refunded on delete.

### ArmRecord (registry; sealed to the owner)
```
public:  guard_id, at, epoch
sealed:  drawn_line_pct, drawn_target_pct     // encrypted to the owner's receipt key
```
Written (`record_arm`) every time the guard arms: at creation and after each rescue's cooldown. With the seal file it proves which line was in force at any moment, which is what a compensation claim needs (§9).

### RescueReceipt (public)
```
public:  at_hour, credit_usd (rounded to 2 significant figures), attestation_ref, latency_s, outcome (pending | early | saved | failed), saved_at_hour?
sealed:  at, hl_credit_usd, hl_tx, intent_hash, distance_before_pct, distance_after_pct, drawn_line_pct, drawn_target_pct, liq_before, closest_to_liq_before_pct   // encrypted to the owner; revealed only with the seal file
published?: at, hl_credit_usd, hl_tx    // only if the owner publishes proof (Ripcord's own test guards always do)
```
The exact credit is visible on Hyperliquid, but nothing public says which credit is a rescue (rule 6). Nothing public reveals the line, the reserve size, or what remains. `outcome` settles within 24 h: `saved` when the mark crosses `liq_before` (the save fee is charged then), `failed` if the guard is liquidated, otherwise `early`. A public `saved` reveals only that the price crossed a liquidation price that was already public before the rescue.

## 4. Flows

### 4.1 Create
1. Web: the trader connects a wallet or pastes an address, which signs nothing (a guard's owner is a key the app makes, §1 of SPEC). The browser reads `clearinghouseState(hl_address)` (public) directly and shows positions with `liquidationPx`.
2. Owner sets the guard (form, or plain English → NEAR AI Cloud copilot → form to confirm).
3. Web generates `salt` (32 B), the owner key (ed25519) and a receipt keypair (X25519), computes `commitment`, encrypts `{settings, salts, secrets}` under the owner's passphrase as the **seal file**, keeps a copy on the device and has the owner save one. `receipt_pk` goes to the checker so sealed receipt fields can be encrypted to the owner.
4. Web encrypts `{settings, salt}` (the settings carry `owner` and `hl_address`) to the checker's enclave key (ECIES) and calls checker `create {guard_id, commitment, owner_commitment, account_commitment, expires_at, enc_settings}` over HTTPS.
5. Checker: decrypts, recomputes commitment (reject mismatch), stores settings, opens the guard's custody wallet (deterministic from `guard_id`), builds its recipient policy (encrypted by OutLayer's keystore and wallet-signed for the registry as caller), and calls registry `register_guard` (Pending) with only the commitments and the encrypted, wallet-signed policy (no address appears in the transaction), which stores the policy on `outlayer.near` and so becomes its controller; returns funding instructions. The web app then registers `hl_address` with each poker over HTTPS, signed by the owner; pokers keep their lists off chain (rule 6).
6. Web shows the reserve deposit: the checker asks the guard's wallet for a private deposit address (`POST /wallet/v1/confidential/deposit/cross-chain`, from Hyperliquid or any supported chain; address + QR). Funds land straight in the confidential balance and the wallet never appears on the public chain (G7: 6.00 USDC sent from Hyperliquid → 4.79903 confidential in 60 s). Never shield from a public balance: that names the wallet on chain (G2).
7. Checker `check` sees reserve ≥ minimum → registry `set_status(Guarding)`.

### 4.2 Check
1. **Poker** (public, cheap): watches mark prices over Hyperliquid's WebSocket (`activeAssetCtx`, not user-specific, so no 10-user cap) and refreshes the liquidation prices of every address registered with it (off chain, §4.1) with `clearinghouseState` every 60 s, every 10 s inside the band, computing distance every second (≈ 500 guards per IP within the 1,200-weight limit; SPEC §4). Calls checker `check {guard_id}` when public distance to liquidation < **30 %** (`POKER_BAND_PCT`), or it fell ≥ 0.5 pp since the last check, or 60 min passed (heartbeat; a 15-min heartbeat would cost ≈ $3.13 per guard-month in checks against ≈ $1.22); while it keeps falling the poker checks on every poll, so the checker's sealed history sees the speed. The band reveals nothing: liquidation prices are public.
2. **Checker**: fetches `clearinghouseState` itself (weight 2; mark = `positionValue / |szi|`) and keeps Hyperliquid's `meta` (maintenance leverage) cached, refreshed daily: Hyperliquid allows 1,200 request weight per minute per IP, shared by everything behind OutLayer's egress IPs (SPEC §4). For each cross position:
   `distance_pct = |liquidationPx − markPx| / markPx × 100`; the guard uses the minimum across positions.
3. `line_pct` is the trigger point currently drawn from `line_range_pct` (rule 5). **Speed-aware trigger:** the checker keeps the guard's last `(t, distance_pct)` samples in sealed storage and computes the fall rate `v` (percentage points per second, ≥ 0) over the last ~60 s. It fires when `distance_pct < line_pct` **or** `distance_pct − v × H < line_pct`, with `H` = the rescue time (default 60 s; the p95 of measured rescues once we have them). So a fast fall is met before it reaches the line, and a slow drift still waits for the line. When it fires on speed, the rescue tops up past the drawn target by `SPEED_BOOST` (3) × `v × H`, the fall expected while the credit lands. **On by default for every preset** (Nov 3, from the replay harness on Binance 1-minute perps data): on the Oct 10 2025 crash it takes Balanced from up to 40 of 53 positions lost that upfront margin saves (SOL 5×) to at most one, and over Oct 2025 – Jun 2026 it is never worse than the plain line in any asset, leverage or reserve. The 1-second spot replays of Oct 22 had shown the gain only for Lean, before the larger top-up existed. Otherwise → `{status: "guarding"}`.
4. Else draw `target_pct` from `target_range_pct` and compute top-up `T` to reach it using Hyperliquid's liquidation formula (docs: `liq_price = price − side × margin_available / position_size / (1 − l × side)`, `l = 1 / MAINTENANCE_LEVERAGE`):
   `T = (target_pct − distance_pct)/100 × markPx × |szi| × (1 − l × side)`, raised to the route's $2 minimum (a $2 rescue lands $1.68 in about 20 s; $1 is refused), so a small position gets $2 rather than nothing, then clamped to `max_rescue_usd`, remaining budget and reserve; skip if those leave less than $2.
5. Rescue (4.3). Output `{status: "rescued"}`; cooldown starts; after cooldown the guard re-arms with a newly drawn `line_pct`.

### 4.3 Rescue
1. If the reserve is not USDC: `POST /wallet/v1/confidential/swap` reserve → NEAR USDC inside the private shard (no public trace).
2. `POST /wallet/v1/confidential/withdraw` on the guard's wallet: `{chain: "hypercore", to: hl_address, amount: T (6-dec USDC), token: nep141:17208628…}`, `X-Idempotency-Key: <guard_id>-<check id>`; the policy refuses any other `to`.
3. Poll `GET /wallet/v1/requests/{id}` until `success` (the realized `amount_out` and the Hyperliquid tx appear only then); read `clearinghouseState` again for `distance_after`.
4. No fee at rescue time. The checker keeps `liq_before` sealed and, on every check for the next 24 h, compares the mark with it: crossed → outcome `saved`, `POST /wallet/v1/confidential/transfer` of the save fee (3 % of the rescued amount (0.5 % on any part above $50,000)) to Ripcord's fee wallet (private, gasless, whitelisted) and registry `record_outcome`; guard liquidated → `failed`; after 24 h → `early`. A close inside the window settles confirmed saves first. The $1 monthly guard fee goes the same way on the first heartbeat of each month.
5. Registry `record_rescue(receipt)`. Measured (G7): credited 33.6 s after the custody call returned, 45.9 s from the checker's request; the custody call itself took 12.3 s. Target: breach → credited p50 < 45 s.
6. If custody answers `503 confidential_unavailable`, the guard shows "paused" and retries; there is no public fallback (it would name the wallet on chain).

### 4.3b Self-firing ladder (shorts, P1) — waiting on 1Click (G6)
> **G6, Oct 21:** 1Click limit orders cannot pay Hyperliquid USDC today (`order-rejected`: pair not available; HyperEVM USDC: passive withdrawals unsupported). Orders can pay the reserve's own confidential USDC balance, or USDC on Arbitrum/Ethereum, so a fill cannot reach the perps balance without the checker. Dropped from the MVP on Oct 21, not dismissed: the design below stays ready to switch on when 1Click adds Hyperliquid payouts, and G6 is re-run on Day 11 (free, unfunded order).
When `reserve_asset` rises with the danger (short position, same-asset reserve):
1. Draw 2–3 rung prices inside the sealed range just below the short's `liquidationPx` (rule 5).
2. For each rung: `POST /v0/orders` — `orderType: LIMIT`, `side: SELL`, `baseAsset: reserve_asset`, `quoteAsset: 1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054`, `price: rung`, `depositType: CONFIDENTIAL_INTENTS`, `refundType: CONFIDENTIAL_INTENTS`, `recipient: hl_address`, `recipientType: DESTINATION_CHAIN`, `confidentiality: basic`, `appFees`; fund by signed intent (same verification as 4.3: recipient, assets, one `transfer`).
3. Fills pay USDC straight into the perps balance; the checker records each fill as a rescue receipt.
4. On every check: if `liquidationPx` moved more than one rung gap, cancel (`POST /v0/orders/{id}/cancel`) and re-place; refresh before the 7-day deadline. Gate G6 proves a filled order credits a Hyperliquid perps balance.

### 4.4 Close / expire
Owner signs `ripcord:close:<guard_id>:<chain>:<address>:<nonce>` (EIP-191 or NEP-413). Checker verifies signer == `owner`, then `/confidential/withdraw` (after `/confidential/swap` if needed) to the signed address, which the policy must list; registry `close`. Expiry does the same to `close_hint` (or holds until the owner signs).

### 4.4b Freeze, unfreeze, policy updates (owner only)
The owner signs `ripcord:freeze:<guard_id>:<nonce>` (or `unfreeze`) with EIP-191 or NEP-413; Ripcord's relayer, or anyone, submits it with `owner` and `owner_salt` to registry `freeze_guard`, which checks that `sha256(owner ‖ owner_salt)` equals the guard's `owner_commitment`, verifies the signature, and calls `outlayer.near.freeze_wallet(wallet_pubkey)`. A frozen wallet refuses every withdrawal until the owner unfreezes it, whatever the checker or Ripcord does. A policy update (e.g. a new close address) needs the owner's signature over `ripcord:policy:<guard_id>:<sha256(encrypted_policy)>:<nonce>` plus the checker-built, wallet-signed blob. The registry has no other path to change, loosen or delete a policy. Nonces are single-use. Proven in G9 (Oct 22) with musags.near as the controller: a frozen wallet refused every operation and even its balance read, and unfreezing restored both; G10 repeats it with the registry contract as the controller.

### 4.5 Reveal & verify
Owner drops the seal file on Verify → web decrypts the sealed receipt fields and shows: `sha256(settings‖salt)` == commitment ✓; every drawn line and target fell inside the sealed ranges and each rescue fired below its drawn line ✓; attestation code hash == the hash OutLayer built from the published GitHub commit ✓.

### 4.6 Agent key: isolated positions (MVP, Day 6; gate G8) and fast lane (P1)
The agent is **the guard's own custody wallet's EVM key** (one per guard, held in OutLayer's keystore; Hyperliquid binds each agent address to one account and warns against reusing agent addresses, so one shared enclave key can't serve every user). The owner signs Hyperliquid `approveAgent` once for that address, under a random name kept in the seal file: anyone can read an account's agents and their names (`extraAgents`), so a name like `ripcord` would announce the guard, and the agent's address is handed only to the owner, sealed, because Hyperliquid can name the account an agent serves. The checker composes the L1 action and its EIP-712 "Agent" message (msgpack + nonce → keccak → phantom agent, domain chainId 1337) and has the guard wallet sign it with `/wallet/v1/evm/sign-typed-data` (the wallet policy must allow `evm_sign`; typed-data signing can't be narrowed by the policy, so add-only is enforced in attested code). Verified for free on Oct 21: OutLayer signed the message, Hyperliquid's own SDK recovered the wallet's address, and Hyperliquid parsed the action and named that address. In the SDK, `updateIsolatedMargin`, orders and `vaultTransfer` are L1 actions (agent-signable); `usdSend`, `withdraw3` and `usdClassTransfer` need the owner's own signature, so the agent **cannot transfer or withdraw** the owner's money. G8 (Oct 21, mainnet): the agent's `updateIsolatedMargin` moved an isolated BTC position's liquidation price $77,298 → $69,508 (+$1); its `usdSend` was refused ("Must deposit before performing actions. User: <agent>": owner-signed actions run as the agent's own empty account); its HLP `vaultTransfer` from the owner's account was refused only by the $5 vault minimum, so **assume an agent can trade and deposit the owner's money into a vault (≥ $5), but never transfer or withdraw it**. The owner can revoke the agent on Hyperliquid at any time, and closing the guard asks the owner to sign one more `approveAgent` that points that name at a fresh dead address (as in G8). The approval's name carries the guard's expiry (`"<name> valid_until <ms>"`), so the agent ends with the guard (first live use on Day 7). Only isolated guards' wallets get `evm_sign` (§2 rule 2).
- **Isolated positions** (what large, hunted positions often use): after a rescue credits the perps balance, the checker calls `updateIsolatedMargin` to move exactly that amount into the endangered isolated position. Add-only, enforced in attested code.
- **Fast lane (P1):** **reduce-only** orders, only when a rescue cannot land in time (distance < `line_pct / 2` and falling), sized to restore `line_pct`.

## 5. Execution modes (`RIPCORD_MODE`)
| Mode | Hyperliquid | Rescue | Use |
|---|---|---|---|
| `demo` | Recorded snapshots + read-only `api.hyperliquid-testnet.xyz` | Mock executor (deterministic, logs the intent it would sign) | AI judges, CI, hunt simulator |
| `mainnet` | `api.hyperliquid.xyz` | Custody withdraw from the guard's wallet | Gate tests, ledger, demo video |

Only the `Rescuer` and `HlClient` traits switch implementation.

**Crash replay harness** (`crates/replay`, on the same `ripcord-rules` functions the checker runs): real 1-minute price paths (Binance USDⓈ-M futures klines from data.binance.vision — Binance carries the highest weight in Hyperliquid's mark price; Hyperliquid's own `candleSnapshot` keeps only recent candles) through the guard, against leaving the position alone and against posting the same reserve upfront as margin. Isolated $10K positions under Hyperliquid's maintenance rule; liquidation tested on each bar's low or high (harsher than the mark); the credit lands 60 s after a rescue fires (120 s as a stress case). Target: no liquidation wherever posting the same reserve upfront would have saved the position. CI runs the Oct 10 2025 crash (`crates/replay/tests/crash.rs`); `cargo run -p ripcord-replay --release -- <from> <to>` runs any months `scripts/replay/fetch.py` has cached, reporting liquidations, rescues, saves and early rescues per asset, leverage, reserve (0.5×, 1×, 2×) and mode. What it found (Nov 3): topping up only to the drawn target can't keep up with a cascade's one-minute drops, so a speed-aware rescue tops up past it by 3× the fall expected while the credit lands (`SPEED_BOOST`); with that, Balanced matches upfront margin on Oct 10, while Lean, whose line sits lower, still loses some positions. **Blind holdout:** presets and `SPEED_BOOST` were tuned only on Oct 2025 – Jun 2026 (the October research had already seen Jul – Sep 2026, so those months can't be blind); predictions for positions opened in October 2026 were written before any of that data was run, and only their sha256 is committed (`crates/replay/holdout/predictions.sha256`, Nov 3), to be revealed and scored once the data through Nov 8 is published.

## 6. Costs & fees
- Fees: save fee 3 % of the rescued amount (0.5 % on any part above $50,000) on a proven save, plus $1 per guard per month, both sent privately with `/confidential/transfer` (custody operations run under OutLayer's 1Click partner id, so `appFees` can't carry them). Early rescues carry no Ripcord fee. Fee research (RESEARCH_NOTES): ≈ $9.18 per $10K position-month at Balanced with a 1× reserve; $15.03 at Lean with 2×.
- Checks: poker band keeps TEE calls rare in calm markets; check budget in NEAR reimburses pokers (`claim_check_fee`). **Measured (G4, Oct 21): $0.001 per TEE check** (OutLayer minimum; ~9.6M instructions), so $1 buys ~1,000 checks; a guard needs ≈ 1,220 a month with an hourly heartbeat (fee research) → ≈ $1.22, covered by the guard fee.
- Latency: a TEE call round-trips in ~6.6 s median (4.6–14.5 s), so one call both decides **and** fires a rescue; never check-then-rescue in two calls. Custody calls add 4–12 s inside that run (G7: open 8.7 s, balance 3.4–7.4 s, withdraw 12.3 s).
- Rescue cost observed: ≈ $0.32 per withdraw to Hyperliquid (G7: 4.79 → 4.468432); funding from Hyperliquid ≈ $0.20 + the $1 `usdSend` surcharge.

## 7. External endpoints (verify before coding)
- Hyperliquid info: `POST https://api.hyperliquid.xyz/info` — `clearinghouseState`, `metaAndAssetCtxs`, `userAbstraction` (testnet: `api.hyperliquid-testnet.xyz`)
- 1Click: `https://1click.chaindefuser.com/v0/{quote,generate-intent,submit-intent,status,tokens}` — partner JWT as `X-API-Key`
- OutLayer: `https://api.outlayer.ai` (mainnet), `https://testnet-api.outlayer.ai` (testnet; intents routes 503). Custody: `POST /register` (deterministic), `GET /wallet/v1/confidential/balance`, `POST /wallet/v1/confidential/{deposit/cross-chain,withdraw,withdraw/dry-run,swap,transfer}`, `GET /wallet/v1/requests/{id}`, `/wallet/v1/policy`, `/encrypt-policy`, `/sign-policy`; auth `Bearer near:<unpadded base64url>`
- NEAR AI Cloud: `https://cloud-api.near.ai/v1/chat/completions` (`Authorization: Bearer`)
- Rhea Lending (make-good fund only): `contract.main.burrow.near`, views `get_asset` (live rate) and `get_account` (the treasury's supplied balance) for the ledger; deposits and withdrawals go through Trezu proposals, so Ripcord writes no Rhea transactions (read `ref-finance/burrowland` before coding the views)
- Trezu (make-good fund): treasury created at trezu.app; docs https://github.com/NEAR-DevHub/trezu-docs (payments, governance, `payments/staking.mdx` for Earn)
- Pyth Hermes (optional sanity and simulator prices): `https://hermes.pyth.network`, `Authorization: Bearer $PYTH_API_KEY`

## 8. Reliability
The rule: when anything is uncertain, the checker does nothing that can lose money. The worst case is *no* rescue, never a wrong payment (pay-to-self in code, recipient whitelist in the wallet policy).

| Stage | What can fail | Answer |
|---|---|---|
| Checks | Our poker goes down; the OutLayer payment key runs dry (a 402 stops every guard at once) | Two independent pokers on different providers, each allowed to call (duplicates are harmless: custody refuses overlapping operations with `wallet_busy`, and every action carries an idempotency key `<guard_id>-<epoch>`). Payment-key balance monitor with auto top-up; alert below 7 days of runway |
| Rate limits | Hyperliquid allows 1,200 request weight a minute per IP and 10 users on per-user WebSocket feeds; checks are needed most when every guard is falling at once | Pokers take mark prices from the per-coin WebSocket feed and refresh liquidation prices every 60 s (10 s in the band): ≈ 500 guards per IP, sharded beyond. The checker reads only `clearinghouseState` (weight 2), at most once per guard per 3 s; OutLayer's egress headroom measured on Day 4 (SPEC §4) |
| Silent gaps | A guard stops being checked | Watchdog: no check within 2× the heartbeat → alert us, and the guard shows **"Guard paused"** with the reason |
| Rescue call | Custody answers 502, 503, `wallet_busy` or `processing` | 502 (`keystore_error`, `confidential_jwt_expired`): retry with the same idempotency key. `processing`: never resubmit; poll its `poll_url`. `wallet_busy`: poll `in_flight_request_id`. 503 `confidential_unavailable`: mark the guard degraded, alert, retry on every check |
| Delivery | 1Click refunds the transfer; the credit is slow | Credit watchdog: no Hyperliquid credit 90 s after the call (≈ p95 + margin) → read the request status; `refunded`/`failed` → fire a fresh rescue at once |
| Route health | A route breaks quietly (seen Oct 29: 1Click confidential quotes timed out for minutes while public quotes worked; RESEARCH_NOTES) | Hourly free `/confidential/withdraw/dry-run` per guard wallet plus a direct 1Click confidential dry quote, so a NEAR Intents outage is told apart from an OutLayer fault (alert on failure or a jump in `time_estimate_seconds`); guards show "Rescues paused" with the reason while it lasts; weekly live canary: a $3–5 real rescue on Ripcord's own guard, end-to-end time published with the ledger |
| Proof | — | Fault injection in the mock executor (demo mode and CI): 502, 503, busy, refund, credit after 60–120 s, poker gaps. Asserts: every guard ends `saved`, `early` or `failed` with the right fee, and no rescue is ever paid twice |

OutLayer has no hosted cron (its `self-hosted-scheduler` runs on our own machines: interval, storage-diff and webhook triggers, no built-in redundancy), so keeping checks alive is our job.

## 9. Compensation evidence
The promise is in PRD §7.1. A claim is decided from evidence, not forms: the owner drops the seal file on Verify, which decrypts the `ArmRecord`s (the line in force at each moment), replays it against Hyperliquid's public prices (and the poker's archive of public snapshots for the guarded account), and lists the attested checks and rescues around the liquidation. The page answers either "Eligible: your line was crossed at 14:03:21 while guarded; no rescue fired" or the reason it isn't (crossed faster than a rescue lands, reserve too small, guard frozen, third-party outage). Claims within 7 days, while Hyperliquid's public history covers the event. Payouts come from the make-good fund: 10 % of every save fee, moved from the fee wallet to a **public Trezu treasury**, a multisig on NEAR whose members, votes, balances and payment requests anyone can see. No single key can pay out: every payout is a payment request that needs 2 of 3 approvals (during the hackathon all three are Jero's own accounts on separate devices, said plainly in the README: it stops a stolen or lost key, not the team; later, independent members). Between claims the treasury supplies its USDC to Rhea Lending (`contract.main.burrow.near`) through Trezu's Earn section, each deposit or withdrawal a voted "Function Call" proposal, so it earns and stays auditable (Rhea `get_account` of the treasury). It keeps a small slice liquid and withdraws from Rhea for larger payouts (USDC withdraws immediately; ≈ $1.87M sat idle on Rhea on Oct 23, against a $10,000 cap per claim). Guard reserves never go to Rhea or Trezu: they would leave their confidential balance.

