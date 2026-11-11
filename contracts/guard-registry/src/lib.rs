//! Ripcord's guard registry (docs/SPEC.md §2). It holds each guard as hashes (never the owner's or the trading
//! account's address), keeps rounded public receipts, and is the controller of every guard wallet's policy on
//! OutLayer, so an owner can freeze their reserve with one signature even if Ripcord disappears.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableSet, LookupMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};
use ripcord_rules::{canonical::canonical, commitment, guard::round_credit};

pub mod sig;
#[cfg(test)]
mod tests;

/// Forwarded to OutLayer with each new policy. OutLayer keeps what the policy's storage costs (about 0.012 NEAR
/// on mainnet) and refunds the rest to the checker as `storage_refund_to`.
pub const POLICY_DEPOSIT: NearToken = NearToken::from_millinear(20);
const GAS_POLICY: Gas = Gas::from_tgas(40);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FREEZE: Gas = Gas::from_tgas(30);
const MAX_PAGE: u32 = 100;
const MAX_CHECKS_PER_CLAIM: u32 = 1_000;
/// One check every 3 s for a full day: the most a guard can ever need.
const MAX_CHECKS_PER_DAY: u32 = 28_800;
const NS_PER_DAY: u64 = 86_400_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GuardStatus {
    Pending,
    Guarding,
    Closed,
    Expired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Pending,
    Saved,
    Early,
    Failed,
}

/// A guard as the public sees it: hashes, status and counts. Nothing here is an address (T-PRIV-01).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Guard {
    pub guard_id: String,
    pub owner_commitment: String,
    pub account_commitment: String,
    pub commitment: String,
    /// The guard wallet's ed25519 key on OutLayer (needed to freeze it); not the owner's.
    pub wallet_pubkey: String,
    pub status: GuardStatus,
    pub created_at: U64,
    pub expires_at: U64,
    pub receipt_count: u32,
    pub arm_count: u32,
    pub check_budget: U128,
}

/// What `record_rescue` takes: rounded to the hour and to 2 significant figures (T-PRIV-02).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RescueInput {
    pub at_hour: u64,
    pub credit_usd: f64,
    pub attestation_ref: String,
    pub latency_s: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PublicReceipt {
    pub at_hour: u64,
    pub credit_usd: f64,
    pub attestation_ref: String,
    pub latency_s: u32,
    pub outcome: Outcome,
    pub saved_at_hour: Option<u64>,
}

/// Exact figures the owner chose to publish, with their Hyperliquid transaction.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Proof {
    pub at: u64,
    pub hl_credit_usd: f64,
    pub hl_tx: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Receipt {
    pub public: PublicReceipt,
    /// Exact amounts, encrypted to the owner.
    pub sealed: String,
    pub proof: Option<Proof>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ArmRecord {
    pub at: U64,
    pub epoch: u64,
    /// The drawn line and target, encrypted to the owner (compensation evidence).
    pub sealed: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Stats {
    pub guards: u64,
    pub rescues: u64,
    pub saves: u64,
    pub margin_added_usd: f64,
}

#[near(serializers = [json])]
pub struct Config {
    pub checker: AccountId,
    pub outlayer: AccountId,
    pub deployer: AccountId,
    pub locked: bool,
    pub check_fee: NearToken,
    pub pokers: Vec<AccountId>,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Guards,
    Receipts,
    Arms,
    ByOwner,
    Nonces,
    Claims,
    Pokers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    guards: LookupMap<String, Guard>,
    /// "<guard_id>/<index>"
    receipts: LookupMap<String, Receipt>,
    arms: LookupMap<String, ArmRecord>,
    by_owner: LookupMap<String, Vec<String>>,
    /// "<owner_commitment>/<nonce>": every owner signature works once.
    used_nonces: LookupSet<String>,
    /// "<guard_id>/<day>": checks paid per guard per day.
    claims: LookupMap<String, u32>,
    pokers: IterableSet<AccountId>,
    checker: AccountId,
    outlayer: AccountId,
    deployer: AccountId,
    locked: bool,
    check_fee: NearToken,
    stats: Stats,
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_nonce(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn key(guard_id: &str, n: impl std::fmt::Display) -> String {
    format!("{guard_id}/{n}")
}

/// Arguments for OutLayer's `store_wallet_policy`. The wallet's signature covers the policy's next version, its lock
/// and a filing deadline, all from the keystore's sign-policy; an older OutLayer takes neither, so both are passed or
/// neither. The registry stores only unlocked
/// policies, so the owner's freeze and close always reach the wallet.
fn store_policy_args(
    wallet_pubkey: &str,
    encrypted_policy: &str,
    wallet_signature: &str,
    version: Option<u64>,
    valid_until: Option<u64>,
    storage_refund_to: Option<AccountId>,
) -> Vec<u8> {
    let mut a = json!({
        "wallet_pubkey": wallet_pubkey,
        "encrypted_data": encrypted_policy,
        "wallet_signature": wallet_signature,
    });
    match (version, valid_until) {
        (Some(v), Some(t)) => {
            a["version"] = json!(v);
            a["locked"] = json!(false);
            a["valid_until"] = json!(t);
        }
        (None, None) => {}
        _ => env::panic_str("policy_version and policy_valid_until come together"),
    }
    if let Some(r) = storage_refund_to {
        a["storage_refund_to"] = json!(r);
    }
    a.to_string().into_bytes()
}

/// NEP-297 event; data never holds an address.
fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let e = json!({ "standard": "ripcord", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{e}"));
}

#[near]
impl Registry {
    #[init]
    pub fn new(checker: AccountId, outlayer: AccountId) -> Self {
        Self {
            guards: LookupMap::new(StorageKey::Guards),
            receipts: LookupMap::new(StorageKey::Receipts),
            arms: LookupMap::new(StorageKey::Arms),
            by_owner: LookupMap::new(StorageKey::ByOwner),
            used_nonces: LookupSet::new(StorageKey::Nonces),
            claims: LookupMap::new(StorageKey::Claims),
            pokers: IterableSet::new(StorageKey::Pokers),
            checker,
            outlayer,
            deployer: env::predecessor_account_id(),
            locked: false,
            // ≈ $0.001 at $4.4/NEAR: OutLayer's minimum per TEE check.
            check_fee: NearToken::from_yoctonear(230_000_000_000_000_000_000),
            stats: Stats::default(),
        }
    }

    // ---------- checker ----------

    /// Stores a new guard (Pending) and makes this registry its wallet's policy controller on OutLayer.
    /// The wallet signature must name this registry as `caller` (OutLayer's `policy_store_message`). See
    /// [`store_policy_args`] for `policy_version` and `policy_valid_until`.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn register_guard(
        &mut self,
        guard_id: String,
        commitment: String,
        owner_commitment: String,
        account_commitment: String,
        expires_at: U64,
        wallet_pubkey: String,
        encrypted_policy: String,
        wallet_signature: String,
        policy_version: Option<u64>,
        policy_valid_until: Option<u64>,
    ) -> Promise {
        self.only_checker();
        require!(commitment::is_guard_id(&guard_id), "invalid guard_id");
        require!(
            is_hex64(&commitment) && is_hex64(&owner_commitment) && is_hex64(&account_commitment),
            "commitments must be 64 lowercase hex characters"
        );
        require!(
            wallet_pubkey.starts_with("ed25519:"),
            "wallet_pubkey must be ed25519:<key>"
        );
        require!(!self.guards.contains_key(&guard_id), "guard_id already registered");
        require!(expires_at.0 > env::block_timestamp(), "expires_at is in the past");

        let before = env::storage_usage();
        let guard = Guard {
            guard_id: guard_id.clone(),
            owner_commitment: owner_commitment.clone(),
            account_commitment,
            commitment: commitment.clone(),
            wallet_pubkey: wallet_pubkey.clone(),
            status: GuardStatus::Pending,
            created_at: U64(env::block_timestamp()),
            expires_at,
            receipt_count: 0,
            arm_count: 0,
            check_budget: U128(0),
        };
        self.guards.insert(guard_id.clone(), guard);
        self.by_owner
            .entry(owner_commitment)
            .or_default()
            .push(guard_id.clone());
        self.stats.guards += 1;
        self.guards.flush();
        self.by_owner.flush();
        let storage = env::storage_byte_cost().saturating_mul((env::storage_usage() - before) as u128);

        let attached = env::attached_deposit();
        let needed = POLICY_DEPOSIT.saturating_add(storage);
        require!(attached >= needed, format!("attach at least {needed}"));
        let refund = attached.saturating_sub(needed);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }
        emit(
            "guard_registered",
            json!({ "guard_id": guard_id, "commitment": commitment }),
        );

        Promise::new(self.outlayer.clone())
            .function_call(
                "store_wallet_policy",
                store_policy_args(
                    &wallet_pubkey,
                    &encrypted_policy,
                    &wallet_signature,
                    policy_version,
                    policy_valid_until,
                    Some(env::predecessor_account_id()),
                ),
                POLICY_DEPOSIT,
                GAS_POLICY,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_policy_stored(guard_id, U128(storage.as_yoctonear())),
            )
    }

    /// If OutLayer refused the policy, the guard never existed: remove it and return both deposits.
    #[private]
    pub fn on_policy_stored(&mut self, guard_id: String, storage: U128) -> bool {
        #[allow(deprecated)]
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if ok {
            return true;
        }
        if let Some(g) = self.guards.remove(&guard_id) {
            if let Some(ids) = self.by_owner.get_mut(&g.owner_commitment) {
                ids.retain(|id| id != &guard_id);
            }
            self.stats.guards -= 1;
            let back = POLICY_DEPOSIT.saturating_add(NearToken::from_yoctonear(storage.0));
            Promise::new(self.checker.clone()).transfer(back).detach();
            emit("guard_policy_failed", json!({ "guard_id": guard_id }));
        }
        false
    }

    pub fn set_status(&mut self, guard_id: String, status: GuardStatus) {
        self.only_checker();
        let g = self.guard_mut(&guard_id);
        let allowed = matches!(
            (g.status, status),
            (GuardStatus::Pending, GuardStatus::Guarding)
                | (GuardStatus::Pending, GuardStatus::Expired)
                | (GuardStatus::Guarding, GuardStatus::Expired)
        );
        require!(allowed, "status change not allowed");
        g.status = status;
        emit("guard_status", json!({ "guard_id": guard_id, "status": status }));
    }

    /// A re-arm: the line and target the enclave just drew, sealed to the owner (compensation evidence).
    pub fn record_arm(&mut self, guard_id: String, epoch: u64, sealed: String) {
        self.only_checker();
        let g = self.guard_mut(&guard_id);
        require!(
            matches!(g.status, GuardStatus::Pending | GuardStatus::Guarding),
            "guard is not active"
        );
        let index = g.arm_count;
        g.arm_count += 1;
        self.arms.insert(
            key(&guard_id, index),
            ArmRecord {
                at: U64(env::block_timestamp()),
                epoch,
                sealed,
            },
        );
        emit("arm_recorded", json!({ "guard_id": guard_id, "epoch": epoch }));
    }

    /// A rescue's public receipt: the hour, the credit to 2 significant figures, whole seconds (T-PRIV-02).
    pub fn record_rescue(&mut self, guard_id: String, public: RescueInput, sealed: String) -> u32 {
        self.only_checker();
        require!(public.at_hour.is_multiple_of(3600), "at_hour must be a whole hour");
        require!(
            public.credit_usd > 0.0 && round_credit(public.credit_usd) == public.credit_usd,
            "credit_usd must be rounded to 2 significant figures"
        );
        let g = self.guard_mut(&guard_id);
        require!(g.status == GuardStatus::Guarding, "guard is not guarding");
        let index = g.receipt_count;
        g.receipt_count += 1;
        let receipt = Receipt {
            public: PublicReceipt {
                at_hour: public.at_hour,
                credit_usd: public.credit_usd,
                attestation_ref: public.attestation_ref,
                latency_s: public.latency_s,
                outcome: Outcome::Pending,
                saved_at_hour: None,
            },
            sealed,
            proof: None,
        };
        self.receipts.insert(key(&guard_id, index), receipt);
        self.stats.rescues += 1;
        self.stats.margin_added_usd += public.credit_usd;
        emit(
            "rescue_recorded",
            json!({
                "guard_id": guard_id, "index": index, "at_hour": public.at_hour,
                "credit_usd": public.credit_usd, "latency_s": public.latency_s,
            }),
        );
        index
    }

    /// Settles a pending rescue within 24 h: saved, early (the price bounced) or failed.
    pub fn record_outcome(&mut self, guard_id: String, index: u32, outcome: Outcome, saved_at_hour: Option<u64>) {
        self.only_checker();
        require!(outcome != Outcome::Pending, "outcome must be saved, early or failed");
        require!(
            saved_at_hour.is_none_or(|h| h.is_multiple_of(3600))
                && (outcome == Outcome::Saved) == saved_at_hour.is_some(),
            "saved_at_hour is a whole hour, given only for a save"
        );
        let r = self
            .receipts
            .get_mut(&key(&guard_id, index))
            .unwrap_or_else(|| env::panic_str("no such receipt"));
        require!(r.public.outcome == Outcome::Pending, "outcome already recorded");
        r.public.outcome = outcome;
        r.public.saved_at_hour = saved_at_hour;
        if outcome == Outcome::Saved {
            self.stats.saves += 1;
        }
        emit(
            "outcome_recorded",
            json!({ "guard_id": guard_id, "index": index, "outcome": outcome }),
        );
    }

    /// Closes a guard after the checker paid out the rest of its reserve; deletes its wallet policy, whose
    /// storage deposit OutLayer refunds to the checker, and returns the unused check budget to the checker.
    pub fn close(&mut self, guard_id: String) -> Promise {
        self.only_checker();
        let g = self.guard_mut(&guard_id);
        require!(g.status != GuardStatus::Closed, "already closed");
        g.status = GuardStatus::Closed;
        let budget = NearToken::from_yoctonear(g.check_budget.0);
        g.check_budget = U128(0);
        let wallet_pubkey = g.wallet_pubkey.clone();
        if !budget.is_zero() {
            Promise::new(self.checker.clone()).transfer(budget).detach();
        }
        emit("guard_closed", json!({ "guard_id": guard_id }));
        Promise::new(self.outlayer.clone()).function_call(
            "delete_wallet_policy",
            json!({ "wallet_pubkey": wallet_pubkey }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FREEZE,
        )
    }

    /// The owner topped up the reserve: stores the wallet policy the checker built with the higher daily cap. The
    /// owner signs a digest that hides the amount; only the checker, which holds the settings sealed, can build the
    /// policy, so both are needed. Nothing here says how much.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn top_up(
        &mut self,
        guard_id: String,
        digest: String,
        encrypted_policy: String,
        wallet_signature: String,
        policy_version: Option<u64>,
        policy_valid_until: Option<u64>,
        owner: String,
        owner_salt: String,
        sig: String,
        nonce: String,
    ) -> Promise {
        self.only_checker();
        require!(is_hex64(&digest), "digest must be 64 lowercase hex characters");
        let message = format!("ripcord:topup:{guard_id}:{digest}:{nonce}");
        let g = self.authorize(&guard_id, &owner, &owner_salt, &sig, &nonce, &message);
        require!(g.status != GuardStatus::Closed, "already closed");
        emit("policy_updated", json!({ "guard_id": guard_id }));
        // OutLayer refunds an update's unused deposit to whoever registration named (the checker).
        Promise::new(self.outlayer.clone()).function_call(
            "store_wallet_policy",
            store_policy_args(
                &g.wallet_pubkey,
                &encrypted_policy,
                &wallet_signature,
                policy_version,
                policy_valid_until,
                None,
            ),
            env::attached_deposit(),
            GAS_POLICY,
        )
    }

    /// The owner changed the rescue range: the checker, which holds the new settings sealed, swaps the guard's
    /// fingerprint for theirs. Every line drawn from here on falls inside the new range.
    pub fn reseal(
        &mut self,
        guard_id: String,
        commitment: String,
        owner: String,
        owner_salt: String,
        sig: String,
        nonce: String,
    ) {
        self.only_checker();
        require!(is_hex64(&commitment), "commitments must be 64 lowercase hex characters");
        let message = format!("ripcord:reseal:{guard_id}:{commitment}:{nonce}");
        self.authorize(&guard_id, &owner, &owner_salt, &sig, &nonce, &message);
        let g = self.guard_mut(&guard_id);
        require!(g.status != GuardStatus::Closed, "already closed");
        g.commitment = commitment.clone();
        let from_arm = g.arm_count;
        emit(
            "guard_resealed",
            json!({ "guard_id": guard_id, "commitment": commitment, "from_arm": from_arm }),
        );
    }

    // ---------- the owner, by signature (anyone may submit) ----------

    /// Freezes the guard wallet: nothing can leave it until the owner unfreezes. Works without Ripcord's servers.
    pub fn freeze_guard(
        &mut self,
        guard_id: String,
        owner: String,
        owner_salt: String,
        sig: String,
        nonce: String,
    ) -> Promise {
        self.set_frozen(guard_id, true, owner, owner_salt, sig, nonce)
    }

    pub fn unfreeze_guard(
        &mut self,
        guard_id: String,
        owner: String,
        owner_salt: String,
        sig: String,
        nonce: String,
    ) -> Promise {
        self.set_frozen(guard_id, false, owner, owner_salt, sig, nonce)
    }

    /// Replaces the wallet's policy (e.g. adds a close address). A freeze survives an update (OutLayer).
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn update_policy(
        &mut self,
        guard_id: String,
        encrypted_policy: String,
        wallet_signature: String,
        policy_version: Option<u64>,
        policy_valid_until: Option<u64>,
        owner: String,
        owner_salt: String,
        sig: String,
        nonce: String,
    ) -> Promise {
        let digest = hex::encode(env::sha256_array(encrypted_policy.as_bytes()));
        let message = format!("ripcord:policy:{guard_id}:{digest}:{nonce}");
        let g = self.authorize(&guard_id, &owner, &owner_salt, &sig, &nonce, &message);
        emit("policy_updated", json!({ "guard_id": guard_id }));
        Promise::new(self.outlayer.clone()).function_call(
            "store_wallet_policy",
            store_policy_args(
                &g.wallet_pubkey,
                &encrypted_policy,
                &wallet_signature,
                policy_version,
                policy_valid_until,
                None,
            ),
            env::attached_deposit(),
            GAS_POLICY,
        )
    }

    /// The owner publishes exact proof of one rescue (its Hyperliquid credit and transaction).
    #[allow(clippy::too_many_arguments)]
    pub fn publish_proof(
        &mut self,
        guard_id: String,
        index: u32,
        proof: Proof,
        owner: String,
        owner_salt: String,
        sig: String,
        nonce: String,
    ) {
        let digest = proof_digest(&proof);
        let message = format!("ripcord:publish:{guard_id}:{index}:{digest}:{nonce}");
        self.authorize(&guard_id, &owner, &owner_salt, &sig, &nonce, &message);
        let r = self
            .receipts
            .get_mut(&key(&guard_id, index))
            .unwrap_or_else(|| env::panic_str("no such receipt"));
        r.proof = Some(proof);
        emit("proof_published", json!({ "guard_id": guard_id, "index": index }));
    }

    // ---------- check budget and pokers ----------

    #[payable]
    pub fn add_check_budget(&mut self, guard_id: String) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach the budget");
        let g = self.guard_mut(&guard_id);
        require!(g.status != GuardStatus::Closed, "guard is closed");
        g.check_budget = U128(g.check_budget.0 + amount);
    }

    /// A poker is paid for the checks it triggered, from the guard's own budget, capped per call and per day.
    pub fn claim_check_fee(&mut self, guard_id: String, checks: u32) -> U128 {
        let poker = env::predecessor_account_id();
        require!(self.pokers.contains(&poker), "only a registered poker");
        require!((1..=MAX_CHECKS_PER_CLAIM).contains(&checks), "checks out of range");
        let day_key = key(&guard_id, env::block_timestamp() / NS_PER_DAY);
        let today = self.claims.get(&day_key).copied().unwrap_or(0);
        require!(today + checks <= MAX_CHECKS_PER_DAY, "daily check limit reached");
        let amount = self.check_fee.as_yoctonear() * checks as u128;
        let g = self.guard_mut(&guard_id);
        require!(g.check_budget.0 >= amount, "check budget too low");
        g.check_budget = U128(g.check_budget.0 - amount);
        self.claims.insert(day_key, today + checks);
        Promise::new(poker).transfer(NearToken::from_yoctonear(amount)).detach();
        U128(amount)
    }

    // ---------- deployer, until lock() ----------

    pub fn set_checker(&mut self, checker: AccountId) {
        self.only_deployer();
        self.checker = checker;
    }

    pub fn add_poker(&mut self, poker: AccountId) {
        self.only_deployer();
        self.pokers.insert(poker);
    }

    pub fn remove_poker(&mut self, poker: AccountId) {
        self.only_deployer();
        self.pokers.remove(&poker);
    }

    pub fn set_check_fee(&mut self, check_fee: NearToken) {
        self.only_deployer();
        self.check_fee = check_fee;
    }

    /// One way: no more admin calls, so no checker change and no upgrade path through this contract.
    pub fn lock(&mut self) {
        self.only_deployer();
        self.locked = true;
    }

    // ---------- views ----------

    pub fn get_guard(&self, guard_id: String) -> Option<Guard> {
        self.guards.get(&guard_id).cloned()
    }

    pub fn guards_for_owner(&self, owner_commitment: String, from: Option<u32>, limit: Option<u32>) -> Vec<Guard> {
        let ids = self.by_owner.get(&owner_commitment).cloned().unwrap_or_default();
        let (from, limit) = (
            from.unwrap_or(0) as usize,
            limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize,
        );
        ids.iter()
            .skip(from)
            .take(limit)
            .filter_map(|id| self.guards.get(id).cloned())
            .collect()
    }

    pub fn get_receipts(&self, guard_id: String, from: Option<u32>, limit: Option<u32>) -> Vec<Receipt> {
        let count = self.guards.get(&guard_id).map_or(0, |g| g.receipt_count);
        page(count, from, limit)
            .filter_map(|i| self.receipts.get(&key(&guard_id, i)).cloned())
            .collect()
    }

    pub fn get_arms(&self, guard_id: String, from: Option<u32>, limit: Option<u32>) -> Vec<ArmRecord> {
        let count = self.guards.get(&guard_id).map_or(0, |g| g.arm_count);
        page(count, from, limit)
            .filter_map(|i| self.arms.get(&key(&guard_id, i)).cloned())
            .collect()
    }

    pub fn stats(&self) -> Stats {
        self.stats.clone()
    }

    pub fn config(&self) -> Config {
        Config {
            checker: self.checker.clone(),
            outlayer: self.outlayer.clone(),
            deployer: self.deployer.clone(),
            locked: self.locked,
            check_fee: self.check_fee,
            pokers: self.pokers.iter().cloned().collect(),
        }
    }
}

impl Registry {
    fn only_checker(&self) {
        require!(env::predecessor_account_id() == self.checker, "only the checker");
    }

    fn only_deployer(&self) {
        require!(!self.locked, "the registry is locked");
        require!(env::predecessor_account_id() == self.deployer, "only the deployer");
    }

    fn guard_mut(&mut self, guard_id: &str) -> &mut Guard {
        self.guards
            .get_mut(guard_id)
            .unwrap_or_else(|| env::panic_str("no such guard"))
    }

    /// The owner reveals `owner` and `owner_salt` matching the guard's commitment and signs `message` once.
    fn authorize(
        &mut self,
        guard_id: &str,
        owner: &str,
        owner_salt: &str,
        sig: &str,
        nonce: &str,
        message: &str,
    ) -> Guard {
        let g = self
            .guards
            .get(guard_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such guard"));
        require!(is_nonce(nonce), "nonce: 1-64 characters of [A-Za-z0-9_-]");
        let ok = commitment::owner_commitment_with(owner, owner_salt, |b| env::sha256_array(b))
            .is_ok_and(|c| c == g.owner_commitment);
        require!(ok, "owner does not match the guard");
        require!(
            sig::verify(owner, message, nonce, sig, env::current_account_id().as_str()),
            "signature is not the owner's"
        );
        require!(
            self.used_nonces.insert(key(&g.owner_commitment, nonce)),
            "nonce already used"
        );
        g
    }

    fn set_frozen(
        &mut self,
        guard_id: String,
        frozen: bool,
        owner: String,
        owner_salt: String,
        sig: String,
        nonce: String,
    ) -> Promise {
        let verb = if frozen { "freeze" } else { "unfreeze" };
        let message = format!("ripcord:{verb}:{guard_id}:{nonce}");
        let g = self.authorize(&guard_id, &owner, &owner_salt, &sig, &nonce, &message);
        emit(
            if frozen { "guard_frozen" } else { "guard_unfrozen" },
            json!({ "guard_id": guard_id }),
        );
        Promise::new(self.outlayer.clone()).function_call(
            if frozen { "freeze_wallet" } else { "unfreeze_wallet" },
            json!({ "wallet_pubkey": g.wallet_pubkey }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FREEZE,
        )
    }
}

fn page(count: u32, from: Option<u32>, limit: Option<u32>) -> impl Iterator<Item = u32> {
    let from = from.unwrap_or(0).min(count);
    let end = from.saturating_add(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)).min(count);
    from..end
}

/// sha256 of the proof's canonical JSON, the same canonical form as everywhere else (docs/SPEC.md §1).
pub fn proof_digest(proof: &Proof) -> String {
    let value = serde_json::to_value(proof).expect("proof serialises");
    let c = canonical(&value).unwrap_or_else(|e| env::panic_str(&format!("proof: {e}")));
    hex::encode(env::sha256_array(c.as_bytes()))
}
