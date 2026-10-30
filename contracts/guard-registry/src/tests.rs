//! Unit tests for the registry: access control, statuses, receipts, owner signatures (T-SEC-06), privacy of
//! state and events (T-PRIV-01, T-PRIV-02), the check budget, and the failed-policy rollback.
use super::*;
use ed25519_dalek::Signer as _;
use k256::ecdsa::SigningKey as EvmKey;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use sha3::{Digest, Keccak256};

const REGISTRY: &str = "registry.testnet";
const CHECKER: &str = "checker.testnet";
const OUTLAYER: &str = "outlayer.testnet";
const DEPLOYER: &str = "deployer.testnet";
const POKER: &str = "poker.testnet";
const STRANGER: &str = "alice.testnet";
const GID: &str = "g-vf6per4bfx";
const HL_ADDRESS: &str = "0x15a6116aeacaa68fd69a17e8abb9e77e24159fe3";
const SALT: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const NOW: u64 = 1_793_541_381_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: NearToken) {
    let c = VMContextBuilder::new()
        .current_account_id(acc(REGISTRY))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(deposit)
        .block_timestamp(NOW)
        .build();
    testing_env!(c);
}

// ---------- owners ----------

struct EvmOwner(EvmKey);

impl EvmOwner {
    fn new(seed: u8) -> Self {
        Self(EvmKey::from_bytes(&[seed; 32].into()).unwrap())
    }
    fn address(&self) -> String {
        let pk = self.0.verifying_key().to_encoded_point(false);
        format!("0x{}", hex::encode(&Keccak256::digest(&pk.as_bytes()[1..])[12..]))
    }
    fn sign(&self, message: &str) -> String {
        let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
        let hash = Keccak256::digest(prefixed.as_bytes());
        let (sig, rec) = self.0.sign_prehash_recoverable(&hash).unwrap();
        let mut b = sig.to_bytes().to_vec();
        b.push(rec.to_byte() + 27);
        format!("0x{}", hex::encode(b))
    }
}

struct NearOwner(ed25519_dalek::SigningKey);

impl NearOwner {
    fn new(seed: u8) -> Self {
        Self(ed25519_dalek::SigningKey::from_bytes(&[seed; 32]))
    }
    fn key(&self) -> String {
        format!(
            "ed25519:{}",
            bs58::encode(self.0.verifying_key().to_bytes()).into_string()
        )
    }
    fn sign(&self, message: &str, nonce: &str, recipient: &str) -> String {
        let hash = sig::nep413_hash(message, &env::sha256_array(nonce.as_bytes()), recipient);
        hex::encode(self.0.sign(&hash).to_bytes())
    }
}

fn owner_commitment(owner: &str) -> String {
    commitment::owner_commitment(owner, SALT).unwrap()
}

// ---------- setup ----------

fn registry() -> Registry {
    ctx(DEPLOYER, NearToken::from_yoctonear(0));
    let mut r = Registry::new(acc(CHECKER), acc(OUTLAYER));
    ctx(DEPLOYER, NearToken::from_yoctonear(0));
    r.add_poker(acc(POKER));
    r
}

fn register(r: &mut Registry, owner: &str) {
    ctx(CHECKER, NearToken::from_millinear(30));
    let _ = r.register_guard(
        GID.into(),
        "c97f4b1fbbe2340d".repeat(4),
        owner_commitment(owner),
        "7a008a939e32fc26".repeat(4),
        U64(NOW + 86_400_000_000_000),
        "ed25519:8d37p1f2q3".into(),
        "encrypted-policy".into(),
        "wallet-signature".into(),
    );
}

fn guarding(owner: &str) -> Registry {
    let mut r = registry();
    register(&mut r, owner);
    ctx(CHECKER, NearToken::from_yoctonear(0));
    r.set_status(GID.into(), GuardStatus::Guarding);
    r
}

fn rescue(r: &mut Registry, credit: f64) -> u32 {
    ctx(CHECKER, NearToken::from_yoctonear(0));
    r.record_rescue(
        GID.into(),
        RescueInput {
            at_hour: 1_793_541_600,
            credit_usd: credit,
            attestation_ref: "att-1".into(),
            latency_s: 38,
        },
        "sealed".into(),
    )
}

// ---------- registration and status ----------

#[test]
fn registers_a_pending_guard_of_hashes() {
    let owner = EvmOwner::new(7).address();
    let mut r = registry();
    register(&mut r, &owner);
    let g = r.get_guard(GID.into()).unwrap();
    assert_eq!(g.status, GuardStatus::Pending);
    assert_eq!(r.guards_for_owner(owner_commitment(&owner), None, None), vec![g]);
    assert_eq!(r.stats().guards, 1);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"guard_registered\"")));
}

#[test]
#[should_panic(expected = "only the checker")]
fn only_the_checker_registers() {
    let mut r = registry();
    ctx(STRANGER, NearToken::from_millinear(30));
    let _ = r.register_guard(
        GID.into(),
        "aa".repeat(32),
        "bb".repeat(32),
        "cc".repeat(32),
        U64(NOW + 1),
        "ed25519:k".into(),
        "p".into(),
        "s".into(),
    );
}

#[test]
#[should_panic(expected = "commitments must be 64 lowercase hex characters")]
fn rejects_an_address_where_a_hash_belongs() {
    let mut r = registry();
    ctx(CHECKER, NearToken::from_millinear(30));
    let _ = r.register_guard(
        GID.into(),
        "aa".repeat(32),
        "bb".repeat(32),
        HL_ADDRESS.into(),
        U64(NOW + 1),
        "ed25519:k".into(),
        "p".into(),
        "s".into(),
    );
}

#[test]
#[should_panic(expected = "attach at least")]
fn needs_the_policy_deposit() {
    let mut r = registry();
    ctx(CHECKER, NearToken::from_millinear(5));
    let _ = r.register_guard(
        GID.into(),
        "aa".repeat(32),
        "bb".repeat(32),
        "cc".repeat(32),
        U64(NOW + 1),
        "ed25519:k".into(),
        "p".into(),
        "s".into(),
    );
}

#[test]
#[should_panic(expected = "guard_id already registered")]
fn a_guard_id_is_registered_once() {
    let owner = EvmOwner::new(7).address();
    let mut r = registry();
    register(&mut r, &owner);
    register(&mut r, &owner);
}

#[test]
#[should_panic(expected = "status change not allowed")]
fn status_moves_forward_only() {
    let mut r = guarding(&EvmOwner::new(7).address());
    ctx(CHECKER, NearToken::from_yoctonear(0));
    r.set_status(GID.into(), GuardStatus::Pending);
}

#[test]
fn a_refused_policy_rolls_the_guard_back() {
    let owner = EvmOwner::new(7).address();
    let mut r = registry();
    register(&mut r, &owner);
    let c = VMContextBuilder::new()
        .current_account_id(acc(REGISTRY))
        .predecessor_account_id(acc(REGISTRY))
        .block_timestamp(NOW)
        .build();
    testing_env!(
        c,
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!r.on_policy_stored(GID.into(), U128(1)));
    assert!(r.get_guard(GID.into()).is_none());
    assert!(r.guards_for_owner(owner_commitment(&owner), None, None).is_empty());
    assert_eq!(r.stats().guards, 0);
}

// ---------- receipts (T-PRIV-02) ----------

#[test]
fn receipts_take_only_rounded_figures() {
    let mut r = guarding(&EvmOwner::new(7).address());
    // The shared rounding vectors: every rounded credit is accepted, every raw one with more digits refused.
    let v: serde_json::Value =
        serde_json::from_str(include_str!("../../../packages/shared/vectors/guard.json")).unwrap();
    for case in v["round_credit"].as_array().unwrap() {
        let (x, credit) = (case["x"].as_f64().unwrap(), case["credit"].as_f64().unwrap());
        if credit > 0.0 {
            rescue(&mut r, credit);
        }
        if x != credit {
            // Refused before anything is written, so the same registry keeps going.
            let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| rescue(&mut r, x))).is_err();
            assert!(refused, "{x} should be refused");
        }
    }
    let rs = r.get_receipts(GID.into(), None, None);
    assert!(rs
        .iter()
        .all(|x| x.public.outcome == Outcome::Pending && x.public.at_hour % 3600 == 0));
    assert_eq!(r.stats().rescues, rs.len() as u64);
}

#[test]
#[should_panic(expected = "at_hour must be a whole hour")]
fn receipts_take_the_hour_only() {
    let mut r = guarding(&EvmOwner::new(7).address());
    ctx(CHECKER, NearToken::from_yoctonear(0));
    r.record_rescue(
        GID.into(),
        RescueInput {
            at_hour: 1_793_541_381,
            credit_usd: 1500.0,
            attestation_ref: "a".into(),
            latency_s: 38,
        },
        "s".into(),
    );
}

#[test]
fn outcomes_settle_once() {
    let mut r = guarding(&EvmOwner::new(7).address());
    let i = rescue(&mut r, 1500.0);
    ctx(CHECKER, NearToken::from_yoctonear(0));
    r.record_outcome(GID.into(), i, Outcome::Saved, Some(1_793_545_200));
    assert_eq!(r.get_receipts(GID.into(), None, None)[0].public.outcome, Outcome::Saved);
    assert_eq!(r.stats().saves, 1);
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        r.record_outcome(GID.into(), i, Outcome::Early, None)
    }));
    assert!(again.is_err());
}

#[test]
#[should_panic(expected = "saved_at_hour is a whole hour, given only for a save")]
fn a_save_names_its_hour() {
    let mut r = guarding(&EvmOwner::new(7).address());
    let i = rescue(&mut r, 1500.0);
    ctx(CHECKER, NearToken::from_yoctonear(0));
    r.record_outcome(GID.into(), i, Outcome::Saved, None);
}

// ---------- owner signatures (T-SEC-06) ----------

fn freeze_evm(r: &mut Registry, owner: &EvmOwner, salt: &str, nonce: &str, message: &str) {
    ctx(STRANGER, NearToken::from_yoctonear(0));
    let _ = r.freeze_guard(
        GID.into(),
        owner.address(),
        salt.into(),
        owner.sign(message),
        nonce.into(),
    );
}

#[test]
fn the_owner_freezes_and_unfreezes_with_an_evm_signature() {
    let o = EvmOwner::new(7);
    let mut r = guarding(&o.address());
    freeze_evm(&mut r, &o, SALT, "n1", &format!("ripcord:freeze:{GID}:n1"));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"guard_frozen\"")));
    ctx(STRANGER, NearToken::from_yoctonear(0));
    let _ = r.unfreeze_guard(
        GID.into(),
        o.address(),
        SALT.into(),
        o.sign(&format!("ripcord:unfreeze:{GID}:n2")),
        "n2".into(),
    );
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"guard_unfrozen\"")));
}

#[test]
#[should_panic(expected = "nonce already used")]
fn a_signature_works_once() {
    let o = EvmOwner::new(7);
    let mut r = guarding(&o.address());
    freeze_evm(&mut r, &o, SALT, "n1", &format!("ripcord:freeze:{GID}:n1"));
    freeze_evm(&mut r, &o, SALT, "n1", &format!("ripcord:freeze:{GID}:n1"));
}

#[test]
#[should_panic(expected = "signature is not the owner's")]
fn another_key_cannot_freeze() {
    let (o, thief) = (EvmOwner::new(7), EvmOwner::new(8));
    let mut r = guarding(&o.address());
    ctx(STRANGER, NearToken::from_yoctonear(0));
    let _ = r.freeze_guard(
        GID.into(),
        o.address(),
        SALT.into(),
        thief.sign(&format!("ripcord:freeze:{GID}:n1")),
        "n1".into(),
    );
}

#[test]
#[should_panic(expected = "owner does not match the guard")]
fn the_wrong_salt_is_refused() {
    let o = EvmOwner::new(7);
    let mut r = guarding(&o.address());
    freeze_evm(&mut r, &o, &"b2".repeat(32), "n1", &format!("ripcord:freeze:{GID}:n1"));
}

#[test]
#[should_panic(expected = "signature is not the owner's")]
fn an_unfreeze_signature_cannot_freeze() {
    let o = EvmOwner::new(7);
    let mut r = guarding(&o.address());
    freeze_evm(&mut r, &o, SALT, "n1", &format!("ripcord:unfreeze:{GID}:n1"));
}

#[test]
fn the_owner_freezes_with_a_near_key() {
    let o = NearOwner::new(9);
    let mut r = guarding(&o.key());
    ctx(STRANGER, NearToken::from_yoctonear(0));
    let _ = r.freeze_guard(
        GID.into(),
        o.key(),
        SALT.into(),
        o.sign(&format!("ripcord:freeze:{GID}:n1"), "n1", REGISTRY),
        "n1".into(),
    );
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"guard_frozen\"")));
}

#[test]
#[should_panic(expected = "signature is not the owner's")]
fn a_near_signature_for_another_contract_is_refused() {
    let o = NearOwner::new(9);
    let mut r = guarding(&o.key());
    ctx(STRANGER, NearToken::from_yoctonear(0));
    let sig = o.sign(&format!("ripcord:freeze:{GID}:n1"), "n1", "other-registry.testnet");
    let _ = r.freeze_guard(GID.into(), o.key(), SALT.into(), sig, "n1".into());
}

#[test]
fn the_owner_publishes_proof_and_a_changed_proof_is_refused() {
    let o = EvmOwner::new(7);
    let mut r = guarding(&o.address());
    let i = rescue(&mut r, 1500.0);
    let proof = Proof {
        at: 1_793_541_381,
        hl_credit_usd: 1486.18,
        hl_tx: "0xabc".into(),
    };
    let msg = format!("ripcord:publish:{GID}:{i}:{}:p1", proof_digest(&proof));
    ctx(STRANGER, NearToken::from_yoctonear(0));
    r.publish_proof(
        GID.into(),
        i,
        proof.clone(),
        o.address(),
        SALT.into(),
        o.sign(&msg),
        "p1".into(),
    );
    assert_eq!(r.get_receipts(GID.into(), None, None)[0].proof, Some(proof.clone()));
    let forged = Proof {
        hl_tx: "0xdef".into(),
        ..proof
    };
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        r.publish_proof(
            GID.into(),
            i,
            forged,
            o.address(),
            SALT.into(),
            o.sign(&msg),
            "p2".into(),
        )
    }));
    assert!(refused.is_err());
}

// ---------- check budget ----------

#[test]
fn pokers_are_paid_from_the_guard_budget_within_limits() {
    let mut r = guarding(&EvmOwner::new(7).address());
    ctx(STRANGER, NearToken::from_near(1));
    r.add_check_budget(GID.into());
    ctx(POKER, NearToken::from_yoctonear(0));
    let paid = r.claim_check_fee(GID.into(), 100);
    assert_eq!(paid.0, r.config().check_fee.as_yoctonear() * 100);
    assert_eq!(
        r.get_guard(GID.into()).unwrap().check_budget.0,
        NearToken::from_near(1).as_yoctonear() - paid.0
    );
    for (who, checks, why) in [
        (STRANGER, 1, "only a registered poker"),
        (POKER, 1001, "checks out of range"),
    ] {
        ctx(who, NearToken::from_yoctonear(0));
        let e = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| r.claim_check_fee(GID.into(), checks)));
        assert!(e.is_err(), "{why}");
    }
}

#[test]
#[should_panic(expected = "check budget too low")]
fn pokers_cannot_overdraw() {
    let mut r = guarding(&EvmOwner::new(7).address());
    ctx(POKER, NearToken::from_yoctonear(0));
    r.claim_check_fee(GID.into(), 1);
}

// ---------- admin ----------

#[test]
#[should_panic(expected = "the registry is locked")]
fn lock_is_one_way() {
    let mut r = registry();
    ctx(DEPLOYER, NearToken::from_yoctonear(0));
    r.lock();
    r.set_checker(acc(STRANGER));
}

// ---------- privacy (T-PRIV-01) ----------

#[test]
fn state_and_events_hold_no_address() {
    let o = EvmOwner::new(7);
    let mut r = guarding(&o.address());
    let mut logs = Vec::new();
    let i = rescue(&mut r, 1500.0);
    logs.extend(get_logs());
    ctx(CHECKER, NearToken::from_yoctonear(0));
    r.record_arm(GID.into(), 1, "sealed-arm".into());
    r.record_outcome(GID.into(), i, Outcome::Saved, Some(1_793_545_200));
    logs.extend(get_logs());
    freeze_evm(&mut r, &o, SALT, "n1", &format!("ripcord:freeze:{GID}:n1"));
    logs.extend(get_logs());

    let state = serde_json::to_string(&(
        r.get_guard(GID.into()),
        r.get_receipts(GID.into(), None, None),
        r.get_arms(GID.into(), None, None),
        r.stats(),
    ))
    .unwrap()
    .to_lowercase();
    let all = logs.join("\n").to_lowercase() + &state;
    for address in [o.address(), HL_ADDRESS.to_string()] {
        assert!(!all.contains(&address.to_lowercase()[2..]), "found {address}");
    }
    assert!(
        !all.contains("0x")
            || !all
                .split("0x")
                .skip(1)
                .any(|s| s.len() >= 40 && s[..40].bytes().all(|b| b.is_ascii_hexdigit()))
    );
}

// ---------- lockstep with packages/shared and scripts/vectors.py ----------

#[test]
fn owner_messages_and_nep413_hashes_match_the_reference() {
    ctx(STRANGER, NearToken::from_yoctonear(0));
    let v: serde_json::Value =
        serde_json::from_str(include_str!("../../../packages/shared/vectors/commitment.json")).unwrap();
    for n in v["nep413"].as_array().unwrap() {
        let (m, nonce, rcpt) = (
            n["message"].as_str().unwrap(),
            n["nonce"].as_str().unwrap(),
            n["recipient"].as_str().unwrap(),
        );
        assert_eq!(
            hex::encode(sig::nep413_hash(m, &env::sha256_array(nonce.as_bytes()), rcpt)),
            n["hash"].as_str().unwrap()
        );
    }
    for m in v["messages"].as_array().unwrap() {
        let (gid, nonce) = (m["guard_id"].as_str().unwrap(), m["nonce"].as_str().unwrap());
        let built = match m["kind"].as_str().unwrap() {
            "publish" => {
                let proof: Proof = serde_json::from_value(m["proof"].clone()).unwrap();
                format!("ripcord:publish:{gid}:{}:{}:{nonce}", m["index"], proof_digest(&proof))
            }
            "policy" => {
                let digest = hex::encode(env::sha256_array(m["encrypted_policy"].as_str().unwrap().as_bytes()));
                format!("ripcord:policy:{gid}:{digest}:{nonce}")
            }
            "freeze" => format!("ripcord:freeze:{gid}:{nonce}"),
            "unfreeze" => format!("ripcord:unfreeze:{gid}:{nonce}"),
            _ => continue, // close is signed for the checker, not the registry
        };
        assert_eq!(built, m["message"].as_str().unwrap());
    }
}
