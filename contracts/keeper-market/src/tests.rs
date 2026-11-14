//! Unit tests for the keeper market: only the enclave credits, once per rescue; a claim pays unclaimed credits once,
//! refuses what the pool can't cover and is restored if the payout fails; the leaderboard ranks by credits.
use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, RuntimeFeesConfig};

const MARKET: &str = "keepers.testnet";
const CHECKER: &str = "checker.testnet";
const OWNER: &str = "owner.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const CAROL: &str = "carol.testnet";
const GID: &str = "g-vf6per4bfx";
const BOUNTY: u128 = 50_000_000_000_000_000_000_000; // 0.05 NEAR

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, balance: NearToken, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc(MARKET))
        .predecessor_account_id(acc(predecessor))
        .account_balance(balance)
        .attached_deposit(deposit)
        .build());
}

fn market() -> KeeperMarket {
    ctx(OWNER, NearToken::from_near(10), NearToken::from_yoctonear(0));
    KeeperMarket::new(acc(CHECKER), acc(OWNER), U128(BOUNTY))
}

fn credit(m: &mut KeeperMarket, index: u32, keeper: &str) {
    ctx(CHECKER, NearToken::from_near(10), NearToken::from_yoctonear(0));
    m.credit(GID.into(), index, acc(keeper));
}

#[test]
#[should_panic(expected = "only the checker credits keepers")]
fn only_the_checker_credits() {
    let mut m = market();
    ctx(ALICE, NearToken::from_near(10), NearToken::from_yoctonear(0));
    m.credit(GID.into(), 0, acc(ALICE));
}

#[test]
fn credits_a_keeper_and_says_so_without_an_account() {
    let mut m = market();
    credit(&mut m, 0, ALICE);
    assert_eq!(m.get_keeper(acc(ALICE)).credits, 1);
    assert!(m.is_credited(GID.into(), 0));
    let log = get_logs().join("\n");
    assert!(log.contains("keeper_credited") && log.contains(ALICE) && log.contains(GID));
    assert!(!log.contains("0x"), "no trading account in events");
}

#[test]
#[should_panic(expected = "already credited")]
fn a_rescue_is_credited_once_even_to_another_keeper() {
    let mut m = market();
    credit(&mut m, 0, ALICE);
    credit(&mut m, 0, BOB);
}

#[test]
fn a_claim_pays_unclaimed_credits_once() {
    let mut m = market();
    credit(&mut m, 0, ALICE);
    credit(&mut m, 1, ALICE);
    ctx(ALICE, NearToken::from_near(10), NearToken::from_yoctonear(0));
    let _ = m.claim();
    let k = m.get_keeper(acc(ALICE));
    assert_eq!((k.credits, k.claimed, k.owed), (2, 2, U128(0)));
    assert!(get_logs()
        .join("\n")
        .contains(&format!("\"amount\":\"{}\"", 2 * BOUNTY)));
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn a_second_claim_has_nothing_to_pay() {
    let mut m = market();
    credit(&mut m, 0, ALICE);
    ctx(ALICE, NearToken::from_near(10), NearToken::from_yoctonear(0));
    let _ = m.claim();
    let _ = m.claim();
}

#[test]
#[should_panic(expected = "the pool can't pay this claim yet")]
fn a_pool_too_small_refuses_the_claim() {
    let mut m = market();
    credit(&mut m, 0, ALICE);
    // A balance that covers only the contract's own storage.
    ctx(ALICE, NearToken::from_millinear(1), NearToken::from_yoctonear(0));
    let _ = m.claim();
}

#[test]
fn a_failed_payout_leaves_the_credits_to_claim_again() {
    let mut m = market();
    credit(&mut m, 0, ALICE);
    ctx(ALICE, NearToken::from_near(10), NearToken::from_yoctonear(0));
    let _ = m.claim();
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc(MARKET))
            .predecessor_account_id(acc(MARKET))
            .build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!m.on_claim(acc(ALICE), 1));
    assert_eq!(m.get_keeper(acc(ALICE)).owed, U128(BOUNTY));
}

#[test]
fn the_leaderboard_ranks_by_rescues_credited() {
    let mut m = market();
    credit(&mut m, 0, ALICE);
    for i in 1..=3 {
        credit(&mut m, i, BOB);
    }
    credit(&mut m, 4, CAROL);
    credit(&mut m, 5, CAROL);
    let order: Vec<(String, u32)> = m
        .leaderboard(None, None)
        .into_iter()
        .map(|k| (k.account.to_string(), k.credits))
        .collect();
    assert_eq!(order, [(BOB.into(), 3), (CAROL.into(), 2), (ALICE.into(), 1)]);
    assert_eq!(m.leaderboard(Some(1), Some(1))[0].account, acc(CAROL));
    let c = m.get_config();
    assert_eq!((c.keepers, c.credits), (3, 6));
}

#[test]
fn anyone_funds_the_pool_and_only_the_owner_sets_the_bounty() {
    let mut m = market();
    ctx(BOB, NearToken::from_near(10), NearToken::from_near(1));
    m.fund();
    assert!(get_logs().join("\n").contains("pool_funded"));
    ctx(OWNER, NearToken::from_near(10), NearToken::from_yoctonear(0));
    m.set_bounty(U128(1));
    assert_eq!(m.get_config().bounty, U128(1));
}

#[test]
#[should_panic(expected = "only the owner sets the bounty")]
fn a_stranger_cannot_set_the_bounty() {
    let mut m = market();
    ctx(ALICE, NearToken::from_near(10), NearToken::from_yoctonear(0));
    m.set_bounty(U128(1));
}

#[test]
#[should_panic(expected = "attach NEAR to fund the pool")]
fn funding_needs_a_deposit() {
    let mut m = market();
    ctx(BOB, NearToken::from_near(10), NearToken::from_yoctonear(0));
    m.fund();
}
