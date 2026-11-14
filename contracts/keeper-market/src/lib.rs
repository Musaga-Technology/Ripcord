//! Ripcord's keeper market: the open network of pokers. Anyone may run one ("a keeper") and name itself on its check
//! calls. A keeper only asks the enclave to check a guard; the enclave alone decides whether to rescue, and nothing a
//! keeper sees names the line. When a keeper's check is the one that fires a rescue, the enclave's account credits
//! that keeper here, once per rescue, and the keeper claims a fixed bounty from a pool anyone can fund.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};

#[cfg(test)]
mod tests;

const GAS_CALLBACK: Gas = Gas::from_tgas(10);
const MAX_PAGE: u32 = 100;

/// A keeper's rescues credited, and how many of them it has been paid for.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Keeper {
    pub credits: u32,
    pub claimed: u32,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct KeeperView {
    pub account: AccountId,
    pub credits: u32,
    pub claimed: u32,
    /// Unclaimed credits times today's bounty, in yoctoNEAR.
    pub owed: U128,
}

#[near(serializers = [json])]
pub struct Config {
    pub checker: AccountId,
    pub owner: AccountId,
    pub bounty: U128,
    /// What the contract can pay out now: its balance less what its storage locks.
    pub pool: U128,
    pub keepers: u32,
    pub credits: u64,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Credited,
    Keepers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct KeeperMarket {
    /// The enclave's own account: the only one that can credit.
    checker: AccountId,
    owner: AccountId,
    /// Paid per credited rescue, in yoctoNEAR.
    bounty: u128,
    /// "<guard_id>/<receipt_index>": every rescue is credited at most once.
    credited: LookupSet<String>,
    keepers: IterableMap<AccountId, Keeper>,
    credits: u64,
}

/// NEP-297 event. Its data names a guard and a keeper, never a trading account or a setting.
fn emit(event: &str, data: serde_json::Value) {
    let e = json!({ "standard": "ripcord-keepers", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{e}"));
}

#[near]
impl KeeperMarket {
    #[init]
    pub fn new(checker: AccountId, owner: AccountId, bounty: U128) -> Self {
        Self {
            checker,
            owner,
            bounty: bounty.0,
            credited: LookupSet::new(StorageKey::Credited),
            keepers: IterableMap::new(StorageKey::Keepers),
            credits: 0,
        }
    }

    /// Adds the attached NEAR to the bounty pool. Anyone may fund it.
    #[payable]
    pub fn fund(&mut self) {
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "attach NEAR to fund the pool");
        emit(
            "pool_funded",
            json!({ "from": env::predecessor_account_id(), "amount": U128(amount.as_yoctonear()) }),
        );
    }

    /// Credits `keeper` for the rescue recorded as `receipt_index` on the guard registry: called by the enclave
    /// when that keeper's check is the one that fired it.
    pub fn credit(&mut self, guard_id: String, receipt_index: u32, keeper: AccountId) {
        require!(
            env::predecessor_account_id() == self.checker,
            "only the checker credits keepers"
        );
        require!(
            self.credited.insert(format!("{guard_id}/{receipt_index}")),
            "already credited"
        );
        let mut k = self.keepers.get(&keeper).copied().unwrap_or_default();
        k.credits += 1;
        self.keepers.insert(keeper.clone(), k);
        self.credits += 1;
        emit(
            "keeper_credited",
            json!({ "guard_id": guard_id, "receipt_index": receipt_index, "keeper": keeper }),
        );
    }

    /// Pays the caller its unclaimed credits times the bounty, if the pool holds it.
    pub fn claim(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let mut k = self.keepers.get(&who).copied().unwrap_or_default();
        let n = k.credits - k.claimed;
        require!(n > 0, "nothing to claim");
        let owed = self.bounty * u128::from(n);
        require!(owed <= self.pool(), "the pool can't pay this claim yet");
        k.claimed = k.credits;
        self.keepers.insert(who.clone(), k);
        emit(
            "bounty_claimed",
            json!({ "keeper": who, "credits": n, "amount": U128(owed) }),
        );
        Promise::new(who.clone())
            .transfer(NearToken::from_yoctonear(owed))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_claim(who, n),
            )
    }

    /// A payout that didn't land leaves its credits unclaimed, to claim again.
    #[private]
    pub fn on_claim(&mut self, keeper: AccountId, credits: u32) -> bool {
        #[allow(deprecated)]
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if !ok {
            let mut k = self.keepers.get(&keeper).copied().unwrap_or_default();
            k.claimed = k.claimed.saturating_sub(credits);
            self.keepers.insert(keeper, k);
        }
        ok
    }

    pub fn set_bounty(&mut self, bounty: U128) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the owner sets the bounty"
        );
        self.bounty = bounty.0;
        emit("bounty_set", json!({ "bounty": bounty }));
    }

    // ---------- views ----------

    pub fn get_keeper(&self, account: AccountId) -> KeeperView {
        let k = self.keepers.get(&account).copied().unwrap_or_default();
        self.view_of(account, k)
    }

    /// Keepers by rescues credited, most first.
    pub fn leaderboard(&self, from: Option<u32>, limit: Option<u32>) -> Vec<KeeperView> {
        let mut all: Vec<(AccountId, Keeper)> = self.keepers.iter().map(|(a, k)| (a.clone(), *k)).collect();
        all.sort_by(|a, b| b.1.credits.cmp(&a.1.credits).then_with(|| a.0.cmp(&b.0)));
        all.into_iter()
            .skip(from.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize)
            .map(|(a, k)| self.view_of(a, k))
            .collect()
    }

    pub fn get_config(&self) -> Config {
        Config {
            checker: self.checker.clone(),
            owner: self.owner.clone(),
            bounty: U128(self.bounty),
            pool: U128(self.pool()),
            keepers: self.keepers.len(),
            credits: self.credits,
        }
    }

    pub fn is_credited(&self, guard_id: String, receipt_index: u32) -> bool {
        self.credited.contains(&format!("{guard_id}/{receipt_index}"))
    }
}

impl KeeperMarket {
    fn view_of(&self, account: AccountId, k: Keeper) -> KeeperView {
        KeeperView {
            account,
            credits: k.credits,
            claimed: k.claimed,
            owed: U128(self.bounty * u128::from(k.credits - k.claimed)),
        }
    }

    /// What can be paid out: the balance less what the contract's storage locks.
    fn pool(&self) -> u128 {
        let locked = env::storage_byte_cost().as_yoctonear() * u128::from(env::storage_usage());
        env::account_balance().as_yoctonear().saturating_sub(locked)
    }
}
