//! The owner's own actions: a freeze the enclave only submits (the registry checks the signature), and a close that
//! only the owner's key can start, which stops rescues, pays the rest to the owner's own account and closes on chain.
use ed25519_dalek::{Signer, SigningKey};
use ripcord_checker::actions::{run, SealedPayload};
use ripcord_checker::commitment::{account_commitment, commitment, owner_commitment};
use ripcord_checker::config::NET;
use ripcord_checker::host::MockHost;
use ripcord_checker::owner::{close_message, nep413_hash};
use ripcord_checker::policy;
use ripcord_checker::seal::{public_key, seal_with};
use ripcord_checker::types::{GuardSettings, Preset};
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
