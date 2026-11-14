//! The open keeper network (feature `keepers`): the keeper whose check fires a rescue is credited once the rescue's
//! receipt is on the registry, once; a check that fires nothing, or names no valid keeper, credits nobody; the rescue
//! itself is the same with or without keepers; and a failed credit never touches the rescue and is tried again.
#![cfg(feature = "keepers")]
use ripcord_checker::actions::{run, SealedPayload};
use ripcord_checker::check::{Opts, Track};
use ripcord_checker::commitment::{account_commitment, commitment, owner_commitment};
use ripcord_checker::host::MockHost;
use ripcord_checker::keepers::{self, is_account_id};
use ripcord_checker::seal::{public_key, seal_with};
use ripcord_checker::types::{CheckStatus, GuardSettings, Preset};
use ripcord_checker::{policy, vault};
use serde_json::{json, Value};
use std::cell::Cell;
use std::rc::Rc;

mod common;
use common::{position, state};

const GID: &str = "g-vf6per4bfx";
const HL: &str = "0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3";
const SALT: &str = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f";
const OWNER_SALT: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const MARKET: &str = "keepers.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const OPTS: Opts = Opts {
    fee_wallet: "",
    canary: false,
};

/// A fixed line at 6 % and target at 10 %, so the tests know where the guard fires.
fn settings() -> GuardSettings {
    GuardSettings {
        owner: "0x9c4e7a1b2c3d4e5f60718293a4b5c6d7e8f941f2".into(),
        hl_address: HL.into(),
        account_salt: "7a008a939e32fc26d75bc749937a97e7b43ad2bf18ebd87b51b0e2e2d84b9e44".into(),
        preset: Preset::Balanced,
        line_range_pct: [6.0, 6.0],
        target_range_pct: [10.0, 10.0],
        speed_aware: false,
        max_rescue_usd: 1500.0,
        budget_usd: 4000.0,
        reserve_asset: policy::USDC.into(),
        cooldown_s: 60,
        isolated: None,
        close_hint: None,
        receipt_pk: format!("x25519:{}", hex::encode(public_key(&[9; 32]))),
        expires_at: "1795046400000000000".into(),
    }
}

fn create(host: &MockHost) {
    let s = settings();
    let enc_pk: [u8; 32] = hex::decode(run(host, r#"{"action":"pubkey"}"#)["enc_pk"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let payload = SealedPayload {
        settings: s.clone(),
        salt: SALT.into(),
        owner_salt: OWNER_SALT.into(),
    };
    let env = seal_with(&[3; 32], &[4; 12], &enc_pk, &serde_json::to_vec(&payload).unwrap(), GID);
    let input = json!({
        "action": "create", "guard_id": GID,
        "commitment": commitment(&s, SALT).unwrap(),
        "owner_commitment": owner_commitment(&s.owner, OWNER_SALT).unwrap(),
        "account_commitment": account_commitment(&s.hl_address, &s.account_salt).unwrap(),
        "expires_at": s.expires_at, "enc_settings": hex::encode(env),
    });
    run(host, &input.to_string());
}

/// A long BTC position at $80,000, its liquidation price `liq`.
fn btc(liq: f64) -> Value {
    state(vec![position("BTC", 1.0, 80_000.0, Some(liq), 40, "cross")])
}

fn check(host: &MockHost, keeper: Option<&str>) -> CheckStatus {
    keepers::check_with(host, GID, keeper, &OPTS, Some(MARKET)).unwrap()
}

/// The args of every signed `credit` transaction (borsh: the method name after its 4-byte length, then the args').
fn credits(txs: &[Vec<u8>]) -> Vec<Value> {
    let m = b"\x06\x00\x00\x00credit";
    txs.iter()
        .filter_map(|raw| {
            let at = raw.windows(m.len()).position(|w| w == m)? + m.len();
            let len = u32::from_le_bytes(raw[at..at + 4].try_into().unwrap()) as usize;
            serde_json::from_slice(&raw[at + 4..at + 4 + len]).ok()
        })
        .collect()
}

#[test]
fn credits_the_keeper_whose_check_fired_the_rescue_once_it_is_on_the_registry() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0); // 5 % away: below the 6 % line
    create(&host);
    assert_eq!(check(&host, Some(ALICE)), CheckStatus::Rescued);
    assert!(credits(&net.borrow().txs).is_empty(), "no receipt yet, so no credit");
    host.now_ms += 30_000;
    // Bob's check is the one that sees the credit land and records the receipt: Alice fired the rescue.
    assert_eq!(check(&host, Some(BOB)), CheckStatus::Guarding);
    assert_eq!(
        credits(&net.borrow().txs),
        [json!({ "guard_id": GID, "receipt_index": 0, "keeper": ALICE })]
    );
    host.now_ms += 10_000;
    check(&host, Some(BOB));
    assert_eq!(credits(&net.borrow().txs).len(), 1, "credited once");
}

#[test]
fn a_check_that_fires_nothing_credits_nobody() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(60_000.0); // 25 % away
    create(&host);
    for _ in 0..3 {
        assert_eq!(check(&host, Some(ALICE)), CheckStatus::Guarding);
        host.now_ms += 30_000;
    }
    assert!(credits(&net.borrow().txs).is_empty());
}

#[test]
fn a_rescue_fired_without_a_valid_keeper_credits_nobody() {
    for keeper in [None, Some("Alice!"), Some(".alice.testnet")] {
        let (mut host, net) = common::host(1);
        net.borrow_mut().hl_state = btc(76_000.0);
        create(&host);
        assert_eq!(check(&host, keeper), CheckStatus::Rescued);
        host.now_ms += 30_000;
        check(&host, Some(BOB));
        assert!(credits(&net.borrow().txs).is_empty(), "{keeper:?}");
    }
}

#[test]
fn the_rescue_is_the_same_with_or_without_keepers() {
    let (plain, plain_net) = common::host(1);
    let (kept, kept_net) = common::host(1);
    for net in [&plain_net, &kept_net] {
        net.borrow_mut().hl_state = btc(76_000.0);
    }
    create(&plain);
    create(&kept);
    let a = ripcord_checker::check::check_with(&plain, GID, &OPTS).unwrap();
    let b = check(&kept, Some(ALICE));
    assert_eq!(a, b);
    assert_eq!(plain_net.borrow().withdraws, kept_net.borrow().withdraws);
    let t = |h: &MockHost| -> Track { vault::get(h, &format!("t/{GID}")).unwrap().unwrap() };
    let (ta, tb) = (t(&plain), t(&kept));
    assert_eq!(
        (ta.rescues.len(), ta.budget_used_usd, ta.rescues[0].liq_before),
        (tb.rescues.len(), tb.budget_used_usd, tb.rescues[0].liq_before)
    );
}

#[test]
fn a_failed_credit_never_touches_the_rescue_and_is_tried_again() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host);
    // The market refuses the first credit transaction; everything else answers as usual.
    let refused = Rc::new(Cell::new(0));
    let r = refused.clone();
    let inner = std::mem::replace(&mut host.responder, Box::new(|_, _, _| (500, vec![])));
    host.responder = Box::new(move |m, url, body| {
        let is_credit = body.is_some_and(|b| {
            let v: Value = serde_json::from_slice(b).unwrap_or_default();
            v["method"] == "send_tx"
                && v["params"]["signed_tx_base64"].as_str().is_some_and(|t| {
                    use base64::Engine;
                    let tx = base64::engine::general_purpose::STANDARD.decode(t).unwrap_or_default();
                    tx.windows(10).any(|w| w == b"\x06\x00\x00\x00credit")
                })
        });
        if is_credit && r.get() == 0 {
            r.set(1);
            let failed = json!({ "jsonrpc": "2.0", "id": "ripcord", "result": {
                "transaction_outcome": { "outcome": { "status": { "SuccessReceiptId": "x" } } },
                "receipts_outcome": [{ "outcome": { "status": { "Failure": { "ActionError": "out of gas" } } } }] } });
            return (200, failed.to_string().into_bytes());
        }
        inner(m, url, body)
    });
    assert_eq!(check(&host, Some(ALICE)), CheckStatus::Rescued);
    host.now_ms += 30_000;
    assert_eq!(
        check(&host, Some(BOB)),
        CheckStatus::Guarding,
        "the refused credit changes nothing"
    );
    assert_eq!(refused.get(), 1);
    host.now_ms += 10_000;
    check(&host, None);
    // The refused try never reached the network's log; the retry did, once, for the keeper who fired.
    assert_eq!(
        credits(&net.borrow().txs),
        [json!({ "guard_id": GID, "receipt_index": 0, "keeper": ALICE })]
    );
    host.now_ms += 10_000;
    check(&host, None);
    assert_eq!(credits(&net.borrow().txs).len(), 1, "landed, so not sent again");
}

#[test]
fn routes_only_checks_and_answers_a_bare_status() {
    let (host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    assert_eq!(
        keepers::run(&host, r#"{"action":"pubkey"}"#, run),
        run(&host, r#"{"action":"pubkey"}"#)
    );
    create(&host);
    let out = keepers::run(
        &host,
        &json!({ "action": "check", "guard_id": GID, "keeper": ALICE }).to_string(),
        run,
    );
    assert_eq!(out, json!({ "status": "rescued" }));
}

#[test]
fn keepers_are_near_accounts() {
    for ok in ["alice.testnet", "a1", "bob_2.near", &"ab".repeat(32)] {
        assert!(is_account_id(ok), "{ok}");
    }
    for bad in [
        "A",
        "a",
        "Alice.near",
        ".alice",
        "alice.",
        "alice..near",
        "alice!",
        &"a".repeat(65),
    ] {
        assert!(!is_account_id(bad), "{bad}");
    }
}
