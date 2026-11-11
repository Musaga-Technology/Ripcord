//! The owner's own actions: a freeze the enclave only submits (the registry checks the signature), and a close that
//! only the owner's key can start, which stops rescues, pays the rest to the owner's own account and closes on chain.
use ed25519_dalek::{Signer, SigningKey};
use ripcord_checker::actions::{run, SealedPayload, StoredGuard};
use ripcord_checker::check::Track;
use ripcord_checker::commitment::{account_commitment, commitment, owner_commitment};
use ripcord_checker::config::NET;
use ripcord_checker::host::MockHost;
use ripcord_checker::owner::{close_message, nep413_hash, reseal_message, topup_digest, topup_message};
use ripcord_checker::policy;
use ripcord_checker::seal::{public_key, seal_with};
use ripcord_checker::types::{GuardSettings, Preset};
use ripcord_checker::{seal, vault};
use serde_json::{json, Value};

mod common;
use common::{position, state};

const GID: &str = "g-vf6per4bfx";
const HL: &str = "0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3";
const SALT: &str = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f";
const OWNER_SALT: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const OWNER_SECRET: [u8; 32] = [7; 32];

fn owner_key() -> String {
    let pk = SigningKey::from_bytes(&OWNER_SECRET).verifying_key();
    format!("ed25519:{}", bs58::encode(pk.as_bytes()).into_string())
}

fn settings() -> GuardSettings {
    GuardSettings {
        owner: owner_key(),
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
    assert_eq!(run(host, &input.to_string())["status"], "pending");
}

/// The owner's NEP-413 signature for the registry, as the browser makes it from the seal file's key.
fn signed(secret: &[u8; 32], message: &str, nonce: &str) -> String {
    hex::encode(
        SigningKey::from_bytes(secret)
            .sign(&nep413_hash(message, nonce, NET.registry))
            .to_bytes(),
    )
}

fn close(host: &MockHost, secret: &[u8; 32], nonce: &str) -> Value {
    let sig = signed(secret, &close_message(GID, "hypercore", HL, nonce), nonce);
    run(
        host,
        &json!({ "action": "close", "guard_id": GID, "sig": sig, "nonce": nonce }).to_string(),
    )
}

#[test]
fn nep413_hashes_match_the_shared_vectors() {
    let v: Value = serde_json::from_str(include_str!("../../packages/shared/vectors/commitment.json")).unwrap();
    for c in v["nep413"].as_array().unwrap() {
        let s = |k: &str| c[k].as_str().unwrap();
        assert_eq!(
            hex::encode(nep413_hash(s("message"), s("nonce"), s("recipient"))),
            s("hash")
        );
    }
}

#[test]
fn owner_messages_match_the_shared_vectors() {
    let v: Value = serde_json::from_str(include_str!("../../packages/shared/vectors/commitment.json")).unwrap();
    for m in v["messages"].as_array().unwrap() {
        let s = |k: &str| m[k].as_str().unwrap();
        let built = match s("kind") {
            "close" => close_message(s("guard_id"), s("chain"), s("address"), s("nonce")),
            "topup" => {
                let digest = topup_digest(s("guard_id"), m["cents"].as_u64().unwrap(), s("salt"));
                assert_eq!(digest, s("digest"));
                topup_message(s("guard_id"), &digest, s("nonce"))
            }
            "reseal" => reseal_message(s("guard_id"), s("commitment"), s("nonce")),
            _ => continue, // the registry checks the rest
        };
        assert_eq!(built, s("message"));
    }
}

#[test]
fn a_freeze_is_submitted_for_the_registry_to_check() {
    let (host, net) = common::host(1);
    let out = run(
        &host,
        &json!({ "action": "freeze", "guard_id": GID, "owner": owner_key(), "owner_salt": OWNER_SALT,
                 "sig": "ab", "nonce": "n1", "frozen": true })
        .to_string(),
    );
    assert_eq!(out, json!({ "status": "frozen" }));
    assert_eq!(net.borrow().methods, ["freeze_guard"]);
}

#[test]
fn only_the_owners_key_can_close() {
    let (host, net) = common::host(1);
    create(&host);
    let out = close(&host, &[8; 32], "n1");
    assert_eq!(out["refused"], "the close is not signed by this guard's owner");
    assert!(net.borrow().withdraws.is_empty());
}

#[test]
fn a_close_pays_the_rest_to_the_owner_and_closes_on_chain() {
    let (host, net) = common::host(1);
    create(&host);
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(74_000.0), 40, "cross")]);
    assert_eq!(
        run(&host, &json!({ "action": "check", "guard_id": GID }).to_string())["status"],
        "guarding"
    );

    assert_eq!(close(&host, &OWNER_SECRET, "n1"), json!({ "status": "pending" }));
    {
        let n = net.borrow();
        assert_eq!(n.withdraws.len(), 1);
        assert_eq!(n.withdraws[0]["to"], HL, "only the owner's own Hyperliquid account");
        assert_eq!(n.withdraws[0]["amount"], "4000000000", "all of it");
    }
    // Closing stops rescues, even below the line.
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(78_000.0), 40, "cross")]);
    assert_eq!(
        run(&host, &json!({ "action": "check", "guard_id": GID }).to_string())["status"],
        "skipped"
    );

    assert_eq!(close(&host, &OWNER_SECRET, "n2"), json!({ "status": "closed" }));
    assert_eq!(net.borrow().methods.last().unwrap(), "close");
    assert_eq!(net.borrow().withdraws.len(), 1, "paid once");
    assert_eq!(close(&host, &OWNER_SECRET, "n3"), json!({ "status": "closed" }));
}

#[test]
fn an_unfunded_guard_closes_without_a_payout_or_a_transaction() {
    let (host, net) = common::host(1);
    net.borrow_mut().balances = Some(json!([]));
    create(&host);
    assert_eq!(close(&host, &OWNER_SECRET, "n1"), json!({ "status": "closed" }));
    let n = net.borrow();
    assert!(n.withdraws.is_empty() && n.txs.is_empty());
}

// ---------- top up and a new range ----------

fn enc_pk(host: &MockHost) -> [u8; 32] {
    hex::decode(run(host, r#"{"action":"pubkey"}"#)["enc_pk"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap()
}

/// What only the enclave opens, sealed as the browser seals it.
fn sealed_for_enclave(host: &MockHost, v: Value) -> String {
    hex::encode(seal_with(
        &[5; 32],
        &[6; 12],
        &enc_pk(host),
        v.to_string().as_bytes(),
        GID,
    ))
}

const ARB_USDC: &str = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";

fn top_up(host: &MockHost, secret: &[u8; 32], cents: u64, nonce: &str) -> Value {
    let salt = "c0ffee00c0ffee00";
    let digest = topup_digest(GID, cents, salt);
    let input = json!({
        "action": "topup", "guard_id": GID, "source_asset": ARB_USDC, "owner_salt": OWNER_SALT, "nonce": nonce,
        "enc_amount": sealed_for_enclave(host, json!({ "cents": cents, "salt": salt })),
        "sig": signed(secret, &topup_message(GID, &digest, nonce), nonce),
    });
    run(host, &input.to_string())
}

fn on_chain(host: &MockHost) {
    assert_eq!(
        run(host, &json!({ "action": "check", "guard_id": GID }).to_string())["status"],
        "guarding"
    );
}

fn stored(host: &MockHost) -> StoredGuard {
    vault::get(host, &format!("s/{GID}")).unwrap().unwrap()
}

#[test]
fn a_top_up_raises_the_budget_and_the_daily_cap_without_saying_how_much() {
    let (host, net) = common::host(1);
    create(&host);
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(74_000.0), 40, "cross")]);
    on_chain(&host);

    let out = top_up(&host, &OWNER_SECRET, 50_000, "t1");
    assert_eq!(out["status"], "pending", "{out}");
    let plain = seal::open(&[9; 32], &hex::decode(out["sealed"].as_str().unwrap()).unwrap(), GID).unwrap();
    let dep: Value = serde_json::from_slice(&plain).unwrap();
    assert_eq!(
        (dep["deposit_address"].as_str(), dep["amount"].as_str()),
        (Some("0xDEP0517"), Some("500000000"))
    );
    assert_eq!(stored(&host).added_usd, 500.0);
    let n = net.borrow();
    assert_eq!(n.methods.last().unwrap(), "top_up");
    let policy = n
        .requests
        .iter()
        .rev()
        .find(|(p, _)| p.ends_with("encrypt-policy"))
        .unwrap();
    assert!(
        policy.1.contains("4500000000"),
        "the daily cap is the budget plus the top-up: {}",
        policy.1
    );
    let tx = String::from_utf8_lossy(n.txs.last().unwrap()).into_owned();
    assert!(
        !tx.contains("50000") && !tx.contains("500.0") && !tx.contains("cents"),
        "no amount on chain"
    );
}

#[test]
fn a_signed_top_up_counts_once() {
    let (host, net) = common::host(1);
    create(&host);
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(74_000.0), 40, "cross")]);
    on_chain(&host);
    top_up(&host, &OWNER_SECRET, 50_000, "t1");
    assert_eq!(
        top_up(&host, &OWNER_SECRET, 50_000, "t1")["status"],
        "pending",
        "the same address again"
    );
    assert_eq!(stored(&host).added_usd, 500.0);
    assert_eq!(net.borrow().methods.iter().filter(|m| *m == "top_up").count(), 1);
}

#[test]
fn only_the_owner_tops_up_a_funded_guard_by_two_dollars_or_more() {
    let (host, net) = common::host(1);
    create(&host);
    assert_eq!(
        top_up(&host, &OWNER_SECRET, 50_000, "t1")["refused"],
        "fund the guard first"
    );
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(74_000.0), 40, "cross")]);
    on_chain(&host);
    assert_eq!(
        top_up(&host, &[8; 32], 50_000, "t2")["refused"],
        "the top-up is not signed by this guard's owner"
    );
    assert_eq!(
        top_up(&host, &OWNER_SECRET, 199, "t3")["refused"],
        "a top-up is $2 or more"
    );
    assert_eq!(stored(&host).added_usd, 0.0);
}

fn reseal(host: &MockHost, secret: &[u8; 32], line: f64, target: f64, signed_for: Option<&str>) -> Value {
    let mut s = settings();
    (s.preset, s.line_range_pct, s.target_range_pct) = (Preset::Safer, [line, line], [target, target]);
    let c = commitment(&s, SALT).unwrap();
    let input = json!({
        "action": "reseal", "guard_id": GID, "commitment": c, "owner_salt": OWNER_SALT, "nonce": "r1",
        "enc_range": sealed_for_enclave(host, json!({
            "preset": "safer", "line_range_pct": [line, line], "target_range_pct": [target, target],
        })),
        "sig": signed(secret, &reseal_message(GID, signed_for.unwrap_or(&c), "r1"), "r1"),
    });
    run(host, &input.to_string())
}

#[test]
fn a_new_range_swaps_the_fingerprint_and_draws_the_next_line_from_it() {
    let (host, net) = common::host(1);
    create(&host);
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(74_000.0), 40, "cross")]);
    on_chain(&host);

    assert_eq!(
        reseal(&host, &OWNER_SECRET, 8.0, 12.0, None),
        json!({ "status": "resealed", "from_epoch": 1 })
    );
    let g = stored(&host);
    assert_eq!(
        (g.settings.line_range_pct, g.settings.preset),
        ([8.0, 8.0], Preset::Safer)
    );
    let mut s = settings();
    (s.preset, s.line_range_pct, s.target_range_pct) = (Preset::Safer, [8.0, 8.0], [12.0, 12.0]);
    assert_eq!(g.commitment, commitment(&s, SALT).unwrap());
    let t: Track = vault::get(&host, &format!("t/{GID}")).unwrap().unwrap();
    assert_eq!((t.epoch, t.line, t.target), (1, 8.0, 12.0));
    let n = net.borrow();
    let last: Vec<&str> = n.methods.iter().rev().take(2).map(String::as_str).collect();
    assert_eq!(
        last,
        ["record_arm", "reseal"],
        "the fingerprint first, then the new line"
    );
}

#[test]
fn a_new_range_needs_the_owners_signature_for_that_range() {
    let (host, _net) = common::host(1);
    create(&host);
    assert_eq!(
        reseal(&host, &[8; 32], 8.0, 12.0, None)["refused"],
        "the new range is not signed by this guard's owner"
    );
    assert_eq!(
        reseal(&host, &OWNER_SECRET, 8.0, 12.0, Some(&"0".repeat(64)))["refused"],
        "the new range is not signed by this guard's owner"
    );
    assert_eq!(
        reseal(&host, &OWNER_SECRET, 60.0, 70.0, None)["refused"],
        "rescue range must sit between 0.5 % and 50 % with low ≤ high"
    );
}

#[test]
fn a_new_range_waits_for_a_rescue_that_is_landing() {
    let (host, net) = common::host(1);
    create(&host);
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 80_000.0, Some(76_000.0), 40, "cross")]);
    assert_eq!(
        run(&host, &json!({ "action": "check", "guard_id": GID }).to_string())["status"],
        "rescued"
    );
    assert_eq!(
        reseal(&host, &OWNER_SECRET, 8.0, 12.0, None)["refused"],
        "a rescue is landing; change the range once it has"
    );
}

#[test]
fn an_unfunded_guard_takes_a_new_range_without_a_transaction() {
    let (host, net) = common::host(1);
    net.borrow_mut().balances = Some(json!([]));
    create(&host);
    assert_eq!(
        reseal(&host, &OWNER_SECRET, 8.0, 12.0, None),
        json!({ "status": "resealed", "from_epoch": 0 })
    );
    assert!(net.borrow().txs.is_empty());
    assert_eq!(stored(&host).settings.line_range_pct, [8.0, 8.0]);
}
