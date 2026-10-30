# Evidence

Every claim in the README, with the test, file or transaction that proves it. Testnet transactions open on testnet.nearblocks.io; mainnet ones arrive from Day 3.

| Claim | Proof |
|---|---|
| The rules agree in three languages: canonical JSON, the settings commitment, owner and account commitments, fingerprints, guard ids, the trigger, rescue sizing, fees, receipt rounding, settlement, owner messages, NEP-413 hashes | Golden vectors written by a standard-library Python reference ([`scripts/vectors.py`](../scripts/vectors.py), `--check` in CI), tested in TypeScript ([`packages/shared/test`](../packages/shared/test)), Rust ([`crates/rules/tests/vectors.rs`](../crates/rules/tests/vectors.rs)) and the contract ([`owner_messages_and_nep413_hashes_match_the_reference`](../contracts/guard-registry/src/tests.rs#L514)) |
| A rescue is paid at most once, whatever the wallet API does; a 503 never falls back to a public route (T-SEC-09) | [`executor.test.ts`](../packages/shared/test/executor.test.ts): 502, 503, busy, refund, slow credit, two pokers at once, 300 random fault mixes |
| The registry holds hashes, not addresses: nothing in state or events names the owner or the trading account (T-PRIV-01) | [`state_and_events_hold_no_address`](../contracts/guard-registry/src/tests.rs#L477); [`rejects_an_address_where_a_hash_belongs`](../contracts/guard-registry/src/tests.rs) |
| Public receipts carry only the hour and the credit to 2 significant figures (T-PRIV-02) | [`receipts_take_only_rounded_figures`](../contracts/guard-registry/src/tests.rs#L233) uses the shared rounding vectors |
| The registry is each guard wallet's policy controller on OutLayer | Testnet: [`register_guard`](https://testnet.nearblocks.io/txns/8Mmt6DwnhkfoZsRqqUqrjn7sDgEhJCSmGE5aCZKcqkPo) made `ripcord-registry-db06d339.testnet` the controller (`outlayer.testnet get_wallet_policy`); `corepack pnpm testnet:registry e2e` reruns it |
| An unlisted recipient is refused (T-SEC-03) | Testnet e2e: OutLayer answered `403 policy_denied`. Mainnet with the owner as controller: gate G9 (Oct 22); with the registry as controller: Day 3 |
| The owner freezes the reserve with one signature, without Ripcord's servers; a frozen wallet refuses even an allowed recipient (T-SEC-05) | Testnet: [owner freeze, NEP-413](https://testnet.nearblocks.io/txns/J6N1R7VZhyZzJoS5fgn4WJ48XqkrQ2He1oFB1nV1qLi9), then `403 wallet_frozen` for an allowed recipient; unfreeze restored it |
| Owner signatures work once; another key, a wrong salt, the wrong action or a signature for another contract is refused (T-SEC-06) | [`a_signature_works_once`](../contracts/guard-registry/src/tests.rs#L328) and the tests after it; testnet e2e: the replayed freeze answered "nonce already used" |
| A refused wallet policy leaves no guard behind | [`a_refused_policy_rolls_the_guard_back`](../contracts/guard-registry/src/tests.rs) |
| Closing a guard deletes its wallet policy and refunds the storage | Testnet e2e: `close`, then `has_wallet_policy` false |
