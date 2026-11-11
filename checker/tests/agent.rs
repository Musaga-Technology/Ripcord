//! The agent key on an isolated guard (ARCHITECTURE §4.6, T-SEC-07): it signs only `updateIsolatedMargin`, each with
//! an expiry, for exactly the credit that landed; without the owner's approval no rescue fires; and a lost answer
//! can't add the margin twice.
use ripcord_checker::actions::{run, SealedPayload};
use ripcord_checker::agent::{action_hash, typed_data};
use ripcord_checker::check::Track;
use ripcord_checker::commitment::{account_commitment, commitment, owner_commitment};
use ripcord_checker::host::MockHost;
use ripcord_checker::seal::{public_key, seal_with};
use ripcord_checker::types::{GuardSettings, Isolated, Preset};
use ripcord_checker::{policy, vault};
use serde_json::{json, Value};

mod common;
use common::{position, state, AGENT};

const GID: &str = "g-vf6per4bfx";
const SALT: &str = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f";
const OWNER_SALT: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";

fn settings() -> GuardSettings {
    GuardSettings {
        owner: "0x9c4e7a1b2c3d4e5f60718293a4b5c6d7e8f941f2".into(),
        hl_address: "0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3".into(),
        account_salt: "7a008a939e32fc26d75bc749937a97e7b43ad2bf18ebd87b51b0e2e2d84b9e44".into(),
        preset: Preset::Balanced,
        line_range_pct: [6.0, 6.0],
        target_range_pct: [10.0, 10.0],
        speed_aware: false,
        max_rescue_usd: 1500.0,
        budget_usd: 4000.0,
        reserve_asset: policy::USDC.into(),
        cooldown_s: 60,
        isolated: Some(Isolated { coin: "HYPE".into() }),
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
    assert_eq!(run(host, &input.to_string())["status"], "pending");
}

fn check(host: &MockHost) -> Value {
    run(host, &json!({ "action": "check", "guard_id": GID }).to_string())["status"].clone()
}

fn track(host: &MockHost) -> Track {
    vault::get(host, &format!("t/{GID}")).unwrap().unwrap()
}

/// An isolated HYPE long near its liquidation price, on a guard whose agent the owner approved.
fn near_liquidation(seed: u8) -> (MockHost, std::rc::Rc<std::cell::RefCell<common::Net>>) {
    let (host, net) = common::host(seed);
    create(&host);
    net.borrow_mut().hl_state = state(vec![position("HYPE", 100.0, 50.0, Some(48.0), 10, "isolated")]);
    net.borrow_mut().agents = json!([{ "name": "x", "address": AGENT, "validUntil": 9_999_999_999_999u64 }]);
    (host, net)
}

#[test]
fn without_the_approval_the_reserve_stays_put() {
    let (host, net) = near_liquidation(1);
    net.borrow_mut().agents = json!([]);
    assert_eq!(check(&host), "skipped");
    assert!(net.borrow().withdraws.is_empty());

    net.borrow_mut().agents = json!([{ "name": "x", "address": AGENT, "validUntil": 1 }]);
    assert_eq!(check(&host), "skipped", "an expired approval is no approval");
    assert!(net.borrow().withdraws.is_empty());
}

#[test]
fn signs_only_an_add_with_an_expiry_for_the_credit_that_landed() {
    let (host, net) = near_liquidation(2);
    assert_eq!(check(&host), "rescued");
    assert!(
        net.borrow().exchange.is_empty(),
        "no margin moves before the credit lands"
    );
    assert_eq!(check(&host), "guarding");

    let n = net.borrow();
    assert_eq!(n.exchange.len(), 1);
    let sent = &n.exchange[0];
    let credited = (track(&host).rescues[0].credited_usd.unwrap() * 1e6).floor() as u64;
    assert_eq!(
        sent["action"],
        json!({ "type": "updateIsolatedMargin", "asset": 2, "isBuy": true, "ntli": credited }),
        "HYPE's place in the universe, the exact credit"
    );
    assert_eq!(sent["expiresAfter"], json!(host.now_ms + 60_000));
    assert_eq!(
        n.signed.len(),
        1,
        "the wallet's EVM key signs this and nothing else (T-SEC-07)"
    );
    assert_eq!(n.signed[0]["typed_data"]["primaryType"], "Agent");
    let hash = action_hash(
        2,
        credited,
        sent["nonce"].as_u64().unwrap(),
        sent["expiresAfter"].as_u64().unwrap(),
    );
    assert_eq!(n.signed[0]["typed_data"], typed_data(&hash, true));
    assert_eq!(sent["signature"]["v"], 0x1b);
    assert!(track(&host).rescues[0].margin_moved);
}

#[test]
fn a_lost_answer_sends_the_same_nonce_so_it_cannot_add_twice() {
    let (host, net) = near_liquidation(3);
    net.borrow_mut()
        .exchange_answers
        .extend(["lost", "Invalid nonce: duplicate nonce"]);
    check(&host);
    assert_eq!(check(&host), "pending", "the answer was lost");
    assert_eq!(check(&host), "guarding", "Hyperliquid had taken the first send");

    let n = net.borrow();
    assert_eq!(n.exchange.len(), 2);
    assert_eq!(n.exchange[0]["nonce"], n.exchange[1]["nonce"]);
    assert!(track(&host).rescues[0].margin_moved);
}

#[test]
fn a_refusal_tries_again_under_a_fresh_nonce_and_a_first_nonce_refusal_is_not_success() {
    let (mut host, net) = near_liquidation(4);
    net.borrow_mut()
        .exchange_answers
        .extend(["Insufficient balance", "Invalid nonce: too low"]);
    check(&host);
    assert_eq!(check(&host), "pending");
    host.now_ms += 3_000;
    assert_eq!(
        check(&host),
        "pending",
        "a nonce refusal with nothing lost before it moved nothing"
    );
    assert!(!track(&host).rescues[0].margin_moved);
    host.now_ms += 3_000;
    assert_eq!(check(&host), "guarding");

    let n = net.borrow();
    assert_eq!(n.exchange.len(), 3);
    assert_ne!(n.exchange[0]["nonce"], n.exchange[2]["nonce"]);
}

#[test]
fn a_cross_guard_never_signs() {
    let (host, net) = common::host(5);
    let enc_pk: [u8; 32] = hex::decode(run(&host, r#"{"action":"pubkey"}"#)["enc_pk"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let mut s = settings();
    s.isolated = None;
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
    run(&host, &input.to_string());
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(77_000.0), 40, "cross")]);
    assert_eq!(check(&host), "rescued");
    check(&host);
    assert!(net.borrow().signed.is_empty() && net.borrow().exchange.is_empty());
}

#[test]
fn the_action_hash_matches_hyperliquids_format() {
    // Packed separately in Python from the SDK's key order and hashed with eth_utils.keccak. Hyperliquid recovered a
    // throwaway signer's address from this format (docs/EVIDENCE.md).
    assert_eq!(
        hex::encode(action_hash(159, 1_250_500_000, 1_793_000_000_000, 1_793_000_060_000)),
        "f0becd3056e81f32621ad9bc0fc5e3327e5e6c22c953c9a7c7ecccd967d580b9"
    );
}
