# Ripcord — Build specs (v2)

Exact interfaces. ARCHITECTURE says what and why; this file fixes the shapes. Everything here was checked against the live services; **verify Day N** marks what needed a live check during the build. When this file and ARCHITECTURE disagree, fix both.

## 1. Shared types and hashes
`packages/shared/src/*.ts` ↔ `crates/rules/src/*.rs` (shared by the checker and the contract) ↔ contract `Guard`, `Receipt`, `ArmRecord`. Golden vectors from `scripts/vectors.py` (a Python reference) test both. Salts are 64 lowercase hex characters, and ‖ joins UTF-8 text. The card fingerprint is the first 4 and last 2 bytes of the commitment (`7F3A 91C2 ···· C91E`); the ledger shows the first 2 and last 2.

| Name | Definition |
|---|---|
| `guard_id` | `"g-"` + 10 lowercase base32 characters (50 random bits) |
| canonical JSON | keys sorted, no whitespace, numbers as decimal strings, EVM addresses lowercase |
| `commitment` | `sha256(canonical(GuardSettings) ‖ salt)`, hex; `salt` = 32 random bytes |
| `owner` | an ed25519 public key (`ed25519:<base58>`, signs NEP-413) or an EVM address (`0x…` lowercase, signs EIP-191). Never a NEAR account name: a contract can't look up an account's keys. **Default: an owner key the app generates at setup**, separate from the trading address, kept in the seal file, so an owner-signed action (freeze, proof, policy) reveals nothing about which trading account is guarded. Optional: the trading wallet itself as owner (simpler; a freeze then shows that account is guarded, said in the UI). Decided Oct 30 |
| `owner_salt` | `sha256(owner's signature over "ripcord:owner-salt:v1")`: deterministic for ed25519 and RFC 6979 wallets, so the app can find an owner's guards without the seal file |
| `owner_commitment` | `sha256(owner ‖ owner_salt)`, hex |
| `account_commitment` | `sha256(lowercase(hl_address) ‖ account_salt)`, hex; `account_salt` = 32 random bytes, sealed |
| fingerprint | first 4 and last 4 bytes of `commitment`, uppercase hex, as printed on the card |

**`GuardSettings`** (sealed, committed): `owner`, `hl_address`, `account_salt`, `preset` (`safer | balanced | lean`), `line_range_pct [lo, hi]`, `target_range_pct [lo, hi]`, `speed_aware` (default true for every preset; Nov 3, from the 1-minute crash replays), `max_rescue_usd` (≥ 5), `budget_usd`, `reserve_asset` (1Click asset id), `cooldown_s` (60), `isolated` (`{coin}` or null), `close_hint` (`{chain, address}` or null), `receipt_pk` (X25519, the owner's), `expires_at` (ns).

**Seal file** (the owner's copy, Day 6): the owner key's and receipt key's secrets, the salts, the settings, the guard id and an isolated guard's agent name, encrypted with a passphrase the user chooses (scrypt → ChaCha20-Poly1305). It is the key to the reserve, so: a close pays by default to the guard's own Hyperliquid address (pay-to-self); a different close address can be named at setup, or added later with an owner-signed `update_policy` that takes effect only after 24 h, which leaves time to freeze if the seal file was stolen.

**Enums.** Registry status `Pending → Guarding → Closed | Expired`. "Paused" (watchdog) and "Frozen" (`outlayer.near` flag) are derived, never stored. Rescue outcome `pending → saved | early | failed` within 24 h.

**Rounding for public receipts** (ARCHITECTURE §2 rule 6): `at_hour = floor(at / 3600 s) × 3600 s`; `credit_usd` to 2 significant figures (`1,486.18 → 1,500`, `640 → 640`); `latency_s` whole seconds.

## 2. Contract: `contracts/guard-registry` (near-sdk, Rust)

**State.** `guards: LookupMap<GuardId, Guard>` · `by_owner: LookupMap<owner_commitment, Vector<GuardId>>` · `used_nonces: LookupSet<(owner_commitment, nonce)>` · `checker: AccountId` (the checker's signing-key account) · `pokers: UnorderedSet<AccountId>` · `outlayer: AccountId` (`outlayer.near`; `outlayer.testnet` on testnet) · `deployer: AccountId` · `locked: bool`.

**`Guard`** (public): `guard_id`, `owner_commitment`, `account_commitment`, `commitment`, `wallet_pubkey` (the guard wallet's ed25519 key, needed for `freeze_wallet`), `status`, `created_at`, `expires_at`, `receipts: Vector<RescueReceipt>`, `arms: Vector<ArmRecord>`, `check_budget: U128`. Nothing in state, arguments or events holds an address (T-PRIV-01).

| Method | Caller | Does |
|---|---|---|
| `new(checker, outlayer)` | deployer | init |
| `register_guard(guard_id, commitment, owner_commitment, account_commitment, expires_at, wallet_pubkey, encrypted_policy, wallet_signature, policy_version?, policy_valid_until?)` payable | `checker` | stores the guard (`Pending`), indexes `by_owner`, forwards `store_wallet_policy(wallet_pubkey, encrypted_policy, wallet_signature)` to `outlayer` with its storage deposit (0.01213 NEAR measured in G9) so the registry becomes the controller; refunds the rest. The wallet signature names `caller` = the registry. Since Nov 6 2026 (OutLayer testnet; mainnet to follow) it also covers the policy's next version, its lock and a filing deadline (7 days): the checker passes `version` and `valid_until` from the keystore's sign-policy, both or neither, and the registry forwards them with `locked: false`, so it never stores a policy its owner's freeze and close couldn't reach |
| `set_status(guard_id, status)` | `checker` | `Pending → Guarding`, `→ Expired` |
| `record_arm(guard_id, epoch, sealed)` | `checker` | appends `ArmRecord {at, epoch, sealed}` (drawn line and target, encrypted to the owner) |
| `record_rescue(guard_id, public, sealed)` | `checker` | appends a receipt; `public` = `{at_hour, credit_usd, attestation_ref, latency_s, outcome: pending}` |
| `record_outcome(guard_id, index, outcome, saved_at_hour?)` | `checker` | settles `pending → saved | early | failed` (was `record_save`) |
| `publish_proof(guard_id, index, proof, owner, owner_salt, sig, nonce)` | anyone, owner-signed | stores `{at, hl_credit_usd, hl_tx}` on that receipt; message `ripcord:publish:<guard_id>:<index>:<sha256(proof)>:<nonce>` |
| `freeze_guard(guard_id, owner, owner_salt, sig, nonce)` / `unfreeze_guard(…)` | anyone, owner-signed | checks `sha256(owner ‖ owner_salt) == owner_commitment` and the signature, burns the nonce, calls `outlayer.freeze_wallet / unfreeze_wallet(wallet_pubkey)`; message `ripcord:freeze:<guard_id>:<nonce>` (`unfreeze`) |
| `update_policy(guard_id, encrypted_policy, wallet_signature, policy_version?, policy_valid_until?, owner, owner_salt, sig, nonce)` | anyone, owner-signed | message `ripcord:policy:<guard_id>:<sha256(encrypted_policy)>:<nonce>`; forwards `store_wallet_policy` (a freeze survives an update), with the version and deadline as for `register_guard` |
| `close(guard_id)` | `checker` | after the checker paid the close; `Closed`; deletes the wallet policy and refunds storage |
| `add_check_budget(guard_id)` payable | anyone | tops up `check_budget` |
| `claim_check_fee(guard_id, checks)` | a `poker` | pays `checks × fee` from `check_budget`, capped per call and per day |
| `set_checker`, `add_poker`, `remove_poker`, `lock()` | deployer, until `lock()` | `lock()` is one-way: no upgrades, no checker change |

**Views.** `get_guard(guard_id)` · `guards_for_owner(owner_commitment, from, limit)` · `get_receipts(guard_id, from, limit)` · `get_arms(guard_id, from, limit)` · `stats()` → `{guards, rescues, saves, margin_added_usd}` (from rounded receipts).

**Signatures.** EIP-191: `keccak256("\x19Ethereum Signed Message:\n" ‖ len ‖ msg)`, `env::ecrecover`, address = last 20 bytes of `keccak256(pubkey)`, must equal `owner`. NEP-413: `sha256(borsh(2^31 + 413) ‖ borsh({message, nonce: [u8; 32], recipient: <registry account>, callback_url: None}))`, `env::ed25519_verify` against the public key in `owner`. Nonces are single-use per `owner_commitment`.

**Events** (NEP-297, standard `ripcord`, version `1.0.0`): `guard_registered {guard_id, commitment}`, `guard_status`, `arm_recorded {guard_id, epoch}`, `rescue_recorded {guard_id, index, at_hour, credit_usd, latency_s}`, `outcome_recorded`, `proof_published`, `guard_frozen`, `guard_unfrozen`, `policy_updated`, `guard_closed`. No addresses, no distances.

**Keys.** Pokers hold **function-call keys** limited to `claim_check_fee` on the registry, with an allowance; the relayer's key is limited to `freeze_guard`, `unfreeze_guard`, `update_policy` and `publish_proof` (it only carries owner signatures). The deployer's full-access key is removed at `lock()`.

**Storage.** A guard ≈ 0.005 NEAR plus the wallet policy's 0.01213 NEAR; `register_guard` takes 0.02 NEAR and refunds the rest. Ripcord's checker account pays it; `close` refunds it.

## 3. Checker: `checker/` (Rust → wasm32-wasip2 on OutLayer)

**Manifest.** `callers: {"direct": "deny", "contract": "deny"}` (HTTPS only, G7). Network: `api.hyperliquid.xyz`, `api.outlayer.ai`, one NEAR RPC for registry writes (the checker signs NEAR transactions with its signing key and sends them over HTTPS: `checker/src/near_tx.rs`), `1click.chaindefuser.com` for token prices. Signing key `checker` ed25519, `bind: project`. Encrypted storage. Every ungated version removed (`remove_version`). Output ≤ 900 bytes JSON.

| Action | Input | Output |
|---|---|---|
| `pubkey` | — | `{enc_pk, account}`: the ECIES X25519 key the web app encrypts to, and the checker's NEAR account |
| `create` | `{guard_id, commitment, owner_commitment, account_commitment, expires_at, enc_settings}` | `{status: "pending"}` (an isolated guard's also carries `sealed`: its agent address, sealed to `receipt_pk`) after: decrypt; recompute all three hashes (reject a mismatch); seal; open the guard's custody wallet (`wallet_id = f(checker account, guard_id)`). Nothing goes on chain: the guard is registered once its reserve arrives (`reserve` or `check`, below), so an unfunded guard costs nothing on NEAR. Retry-safe |
| `fund` | `{guard_id, source_asset}` | `{status: "pending", sealed}`: a private deposit address from the guard's wallet (`/confidential/deposit/cross-chain`) for the sealed budget in `source_asset` (1Click price), with that amount, sealed to `receipt_pk` (guard ids are public, and whoever holds the address can read the reserve's size on its chain). Works before the guard is on chain |
| `reserve` | `{guard_id}` | `{status, sealed}`: the guard wallet's confidential balances, sealed to `receipt_pk`, so a stranger's call learns nothing, not even whether it is funded. The first `reserve` or `check` that sees money registers the guard: build the policy (below) → `/encrypt-policy`, `/sign-policy` with `caller` = registry → `register_guard`, signed by the checker's own key; a guard already on chain is only marked |
| `freeze` | `{guard_id, owner, owner_salt, sig, nonce, frozen}` | `{status: "frozen" \| "guarding"}`: submits the owner's NEP-413-signed `freeze_guard` or `unfreeze_guard` to the registry, which checks the owner commitment and the signature, refuses a used nonce, and freezes or unfreezes the wallet on OutLayer. The enclave only pays the gas |
| `close` | `{guard_id, sig, nonce}` | `{status: "pending" \| "closed"}`, one step per call: the owner's NEP-413 signature over `ripcord:close:<guard_id>:hypercore:<hl_address>:<nonce>`, checked in the enclave against the sealed owner key; from then on `check` answers `skipped`. Swaps a non-USDC reserve into USDC (refused under 97 % of its listed value), withdraws all USDC to `hl_address` (nothing under $2, the route's minimum), then calls registry `close`, which deletes the wallet policy and refunds its storage |
| `check` | `{guard_id}` | `{status: guarding | rescued | pending | skipped}`, nothing else (rule 4) |
| `close` | `{guard_id, chain, address, nonce, sig}` | `{status: "closed"}`; owner signs `ripcord:close:<guard_id>:<chain>:<address>:<nonce>`; the address must be on the policy (if not, `policy` first) |
| `policy` | `{guard_id, close: {chain, address}}` | `{encrypted_policy, wallet_signature, policy_version?, policy_valid_until?}` for an owner-signed `update_policy` |

**Sealed storage.** Each record is encrypted under the `vault` key with its name as associated data and stored under `v/` + hex(mac(name)), so the storage operator sees neither names nor values. `s/<guard_id>`: settings, salt and the registration transaction. `t/<guard_id>`: `{epoch, drawn_line, drawn_target, history: [(t, distance)] for the last 60 s, pending: [{index, liq_before, at, amount, request_id}], budget_used, last_fee_month}`. `i/<key>`: idempotency records.

**One `check`, in order.**
1. Skip if closed or expired. Read `clearinghouseState(hl_address)` **only** (weight 2): `mark = positionValue / |szi|`; distance per position `|liquidationPx − mark| / mark`; the guard's distance is the minimum over cross positions, or the isolated coin's. The maintenance fraction is `1 / (2 × maxLeverage)`, from the same position entry (Hyperliquid lists `maxLeverage` per position; verified Nov 1), so no `meta` read (weight 20) is needed. Never `metaAndAssetCtxs` per check. The first check of a registered guard draws epoch 0, records it with `record_arm` (the draw sealed to `receipt_pk`), and sets the guard `Guarding`.
2. Settle pending rescues: `saved` if the mark is past `liq_before`; `failed` if the position was liquidated; `early` after 24 h. A crossing missed between checks counts as early, in the owner's favour.
3. Trigger: fire if `distance < drawn_line`, or, with `speed_aware`, `distance − v × H < drawn_line`, where `v` is the fall rate over the last 60 s (≥ 0) and `H` = 60 s (later the measured p95).
4. Size `T = (drawn_target − distance)/100 × mark × |szi| × (1 − l × side)`; raise to $2, the route's minimum; clamp to `max_rescue_usd`, the remaining budget and what the reserve holds (its balance, read just before firing; a non-USDC reserve counts 3 % less for the swap); skip when that room is under $2.
5. Rescue: `/confidential/swap {token_in: reserve, token_out: USDC, amount_in: 1.03 × the rescue at the 1Click price, min_amount_out: 98 %}` if the reserve isn't USDC → `/confidential/withdraw {chain: "hypercore", to: hl_address, amount, token}` with `X-Idempotency-Key: <guard_id>-<epoch>` (`-w` after a swap); store the request, return `rescued` (don't wait for the credit). Later checks read `GET /wallet/v1/requests/{id}` and answer `pending` while it settles: `success` gives `amount_out` and the Hyperliquid tx (`swap_details.destinationChainTxHashes`); then `record_rescue` with the hour and the credit to 2 significant figures in public and the exact amount, time and Hyperliquid tx sealed to `receipt_pk`. `refunded` fires again at once under `<guard_id>-<epoch>-r<n>` (at most twice), then gives the budget back; 502 and 409 `wallet_busy` send the same key on the next check. An isolated guard fires only while its agent is approved (`extraAgents`), since a credit can't reach the position otherwise. Once the credit lands, the guard wallet signs `updateIsolatedMargin` for exactly that credit with `expiresAfter` = now + 60 s: a refusal tries again under a fresh nonce (the credit may not be usable yet), a lost answer sends the same nonce so it can't apply twice, and after 40 tries it stops, with the USDC still in the owner's account.
6. After `cooldown_s` from the credit: `epoch += 1`, draw a new line and target inside the sealed ranges with enclave randomness, `record_arm`.
7. Fees: on `saved`, `/confidential/transfer` of `3 % × min(T, 50,000) + 0.5 % × max(T − 50,000, 0)` to the fee wallet (key `<guard_id>-fee-<index>`), then `record_outcome`. On the first heartbeat of each month, $1 (key `<guard_id>-month-<YYYY-MM>`).
8. Errors follow ARCHITECTURE §8 (502 retry with the same key, `processing` poll, `wallet_busy` poll, 503 → degraded). Logs hold guard ids, statuses and timings only.

**Guard wallet policy** (G9's working format):
```json
{
  "rules": {
    "transaction_types": ["confidential"],
    "addresses": { "mode": "whitelist", "list": ["<hl_address>", "<close address, if any>", "<fee wallet>"] },
    "limits": {
      "per_transaction": { "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "<max_rescue_usd × 1e6>", "<reserve_asset>": "<the same in reserve units, with 20 % headroom>" },
      "daily": { "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "<budget_usd × 1e6>" }
    }
  },
  "capabilities": { "confidential": { "allowed": true }, "evm_sign": { "allowed": "<isolated guard>", "raw_tx": false }, "solana_sign": { "allowed": false } }
}
```
No `approval` block. The fee wallet is a confidential identity: `/confidential/transfer` takes `{to, amount, token}` with `to` = the recipient's 64-hex intents id (verified Nov 3 in OutLayer's confidential docs), so `RIPCORD_FEE_WALLET` is that id, compiled in; unset (zeros), no fee is charged.

**Web route.** `apps/web/app/api/checker` carries a browser's requests to the checker with Ripcord's payment key, which stays on the server. It takes only `pubkey`, `create`, `fund` and `reserve` (never `check`), 30 a minute per IP, and logs nothing. It only ever sees hashes and ciphertext. Positions, the registry and the pokers are reached from the browser directly, so Ripcord's web server never learns which account a session belongs to.

## 4. Pokers: `services/poker/` (Node)

**Hyperliquid's limits shape this** (read Oct 22): REST 1,200 weight per minute per IP (`clearinghouseState` and `allMids` weight 2, most other info 20); WebSocket at most 10 connections, 1,000 subscriptions and **10 unique users** per IP across user-specific feeds. So:
- **Prices:** WebSocket `activeAssetCtx` for each coin in use (mark price; not user-specific). Fallback: `allMids` every 3 s.
- **Liquidation prices:** `clearinghouseState` per address every 60 s, every 10 s inside the band, and right after a rescue lands. Distance is computed locally every second. That is ≈ 500 guards per IP with headroom; beyond that, shard across IPs.
- **Call the checker** when: distance < 30 % and it fell ≥ 0.5 pp since the last check, or every 3 s while it keeps falling; the hourly heartbeat; a **settlement watch** (the mark within 0.5 % of a pending rescue's pre-rescue liquidation price, which was public); right after a rescue (to record it).
- **The checker's own reads** come from OutLayer's egress IPs, which share the same budget: one weight-2 read per check, at most one check per guard per 3 s. **Verify Day 4**: OutLayer's egress IPs and the headroom during a burst.

| Endpoint | Does |
|---|---|
| `PUT /v1/watch/{guard_id} {hl_address, account_salt}` | registers an address; `sha256(lowercase(hl_address) ‖ account_salt)` must equal the registry's `account_commitment`, and only the owner's device holds the salt, so that is the proof (no separate signature); stored AES-256-GCM-encrypted at rest |
| `DELETE /v1/watch/{guard_id} {hl_address, account_salt}` | stops watching, with the same proof (also on `guard_closed`) |
| `GET /v1/health/{guard_id}` | `{last_check_at, checks_24h}`, no address. The app shows "Guard paused" when `last_check_at` is older than 2× the heartbeat |

Checker call: `POST https://api.outlayer.ai/call/<owner>/<project>` with `X-Payment-Key`, body `{action: "check", guard_id}`, 30 s timeout; duplicates are harmless. Two pokers on different providers, each independent. Payment key monitor: `GET /public/payment-keys/<owner>/<nonce>/balance`, alert under 7 days of runway. `claim_check_fee` with a function-call key. Logs: guard id, status, timing; never an address.

## 5. MCP tool: `packages/mcp/` (stdio, runs on the owner's machine)

`npx ripcord-mcp`. Config: `RIPCORD_API` (Ripcord's public API, which calls the checker with Ripcord's payment key), optional `OWNER_KEY` (only when the agent owns the trading account; otherwise every owner signature comes back as a `sign_url` for the person). Settings are encrypted on this machine; the seal file is written next to it.

| Tool | Input | Output |
|---|---|---|
| `guard_position` | `{hl_address, reserve: {asset, amount}, preset?: "safer" \| "balanced" \| "lean", expires_days?: 1–90}` | `{guard_id, fingerprint, status: "pending", fund: {chain, address}, seal_file}` |
| `fund_reserve` | `{guard_id, source_asset}` | `{fund: {chain, address, min_amount}}` (checker `fund`) |
| `guard_status` | `{guard_id}` | `{status, last_check_at, rescues, outcomes: {saved, early, settling}, frozen}` |
| `close_guard` | `{guard_id, to: {chain, address}}` | `{status: "closed"}` or `{sign_url}` |

No tool takes a rescue recipient or edits the allowlist: rescues always pay the sealed `hl_address`; only `close_guard` names an address, and it needs the owner's signature. NEAR AI Agent Market listing "hire a liquidation guard" (**verify Day 11**: `market.near.ai/skill.md`).

## 6. Named tests (each attack-table row and each privacy rule; Day 12 links them in `docs/EVIDENCE.md`)

| Test | Proves | Where |
|---|---|---|
| T-SEC-01 | the checker ignores poker input; recipient and amount come from sealed settings | checker unit |
| T-SEC-02 | a stranger's HTTPS call opens no guard wallet (keys derive per caller) | checker integration, **verify Day 3** |
| T-SEC-03 | an unlisted recipient is refused | G9 ✅; Day 3 again with the registry as controller |
| T-SEC-04 | an over-cap amount is refused | G9 ✅; Day 3 |
| T-SEC-05 | a freeze refuses everything; unfreeze restores it | G9 ✅ (owner as controller); G10 / Day 3 (registry) |
| T-SEC-06 | owner signatures can't be replayed; wrong owner, wrong salt, wrong recipient on NEP-413 rejected | contract unit |
| T-SEC-07 | the agent key only ever signs `updateIsolatedMargin`, each with `expiresAfter` | `checker/tests/agent.rs` |
| T-SEC-08 | no copilot or MCP output can change a rescue's recipient (adversarial inputs) | web + MCP |
| T-SEC-09 | fault injection: 502, 503, busy, refund, slow credit, poker gaps; no rescue is paid twice | mock executor, CI |
| T-SEC-10 | the fee is exactly the tier, once per save | checker unit |
| T-PRIV-01 | registry state, arguments, events and logs contain no address | contract + CI log scan |
| T-PRIV-02 | public receipts are rounded (hour, 2 significant figures) | contract unit |
| T-PRIV-03 | checker output is only a status | checker unit |
| T-PRIV-04 | the line can't be learned: replayed rescues scatter across the sealed range | replay harness ("learn the line") |
| T-REL-01 | cascades: Balanced with speed-aware loses no position that the same reserve posted upfront saves (within one, Oct 10 2025); speed-aware never worse than plain | replay harness, `crates/replay/tests/crash.rs`, CI |
