//! `pubkey` and `create` against a mock host: sealed settings open only for their guard, must match all three
//! public hashes, are validated, and are kept sealed; outputs carry a status and never a setting (T-PRIV-03).
use ripcord_checker::actions::{run, SealedPayload, StoredGuard};
use ripcord_checker::commitment::{account_commitment, commitment, owner_commitment};
use ripcord_checker::host::{Host, MockHost};
use ripcord_checker::seal::seal_with;
use ripcord_checker::types::{GuardSettings, Isolated, Preset};
use ripcord_checker::{policy, vault};
use serde_json::{json, Value};

mod common;

const GID: &str = "g-vf6per4bfx";
const HL: &str = "0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3";
const SALT: &str = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f";
const OWNER_SALT: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const FEE_WALLET: &str = "ripcord-fees.near";

type Change = fn(&mut GuardSettings);

fn settings() -> GuardSettings {
    GuardSettings {
        owner: "0x9c4e7a1b2c3d4e5f60718293a4b5c6d7e8f941f2".into(),
        hl_address: HL.into(),
        account_salt: "7a008a939e32fc26d75bc749937a97e7b43ad2bf18ebd87b51b0e2e2d84b9e44".into(),
        preset: Preset::Balanced,
        line_range_pct: [5.0, 8.0],
        target_range_pct: [9.0, 13.0],
        speed_aware: false,
        max_rescue_usd: 1500.0,
        budget_usd: 4000.0,
        reserve_asset: policy::USDC.into(),
        cooldown_s: 60,
        isolated: None,
        close_hint: None,
        receipt_pk: format!("x25519:{}", "5e".repeat(32)),
        expires_at: "1795046400000000000".into(),
    }
}

fn enc_pk(host: &MockHost) -> [u8; 32] {
    let out = run(host, r#"{"action":"pubkey"}"#);
    hex::decode(out["enc_pk"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap()
}

/// What the owner's browser sends: the three hashes in public, the settings sealed to the enclave.
fn create_input(host: &MockHost, s: &GuardSettings, gid: &str, sealed_for: &str) -> String {
    let payload = SealedPayload {
        settings: s.clone(),
        salt: SALT.into(),
        owner_salt: OWNER_SALT.into(),
    };
    let env = seal_with(
        &[3u8; 32],
        &[4u8; 12],
        &enc_pk(host),
        &serde_json::to_vec(&payload).unwrap(),
        sealed_for,
    );
    json!({
        "action": "create",
        "guard_id": gid,
        "commitment": commitment(s, SALT).unwrap(),
        "owner_commitment": owner_commitment(&s.owner, OWNER_SALT).unwrap(),
        "account_commitment": account_commitment(&s.hl_address, &s.account_salt).unwrap(),
        "expires_at": s.expires_at,
        "enc_settings": hex::encode(env),
    })
    .to_string()
}

#[test]
fn pubkey_publishes_the_sealing_key_and_the_checker_account() {
    let (host, _net) = common::host(1);
    let out = run(&host, r#"{"action":"pubkey"}"#);
    assert_eq!(out["enc_pk"].as_str().unwrap().len(), 64);
    assert_eq!(out["account"].as_str().unwrap().len(), 64);
    assert_eq!(
        run(&host, r#"{"action":"pubkey"}"#),
        out,
        "derived again on every run, the same"
    );
    assert_ne!(
        run(&MockHost::new(2), r#"{"action":"pubkey"}"#),
        out,
        "another project, another key"
    );
}

#[test]
fn creates_a_guard_and_keeps_its_settings_sealed() {
    let (host, _net) = common::host(1);
    let out = run(&host, &create_input(&host, &settings(), GID, GID));
    assert_eq!(out, json!({ "status": "pending" }));
    let stored: StoredGuard = vault::get(&host, &format!("s/{GID}")).unwrap().unwrap();
    assert_eq!(stored.settings, settings());
    let key = vault::raw_key(&host, &format!("s/{GID}")).unwrap();
    assert!(!key.contains(GID), "the operator can't tell which guard a record is");
    let raw = host.get_raw(&key).unwrap().unwrap();
    assert!(
        !String::from_utf8_lossy(&raw)
            .to_lowercase()
            .contains(&HL[2..].to_lowercase()),
        "stored sealed, not plain"
    );
    assert_eq!(
        run(&host, &create_input(&host, &settings(), GID, GID)),
        out,
        "a retry is harmless"
    );
}

#[test]
fn refuses_settings_sealed_for_another_guard() {
    let (host, _net) = common::host(1);
    let out = run(&host, &create_input(&host, &settings(), GID, "g-aaaaaaaaaa"));
    assert_eq!(out["refused"], "enc_settings does not open for this guard");
}

#[test]
fn refuses_settings_that_do_not_match_the_public_hashes() {
    let (host, _net) = common::host(1);
    let mut input: Value = serde_json::from_str(&create_input(&host, &settings(), GID, GID)).unwrap();
    input["account_commitment"] = json!("00".repeat(32));
    let out = run(&host, &input.to_string());
    assert_eq!(out["refused"], "settings do not match the public commitments");
    assert!(host.storage.borrow().is_empty());
}

#[test]
fn refuses_unsafe_settings() {
    let (host, _net) = common::host(1);
    let cases: Vec<(Change, &str)> = vec![
        (
            |s| s.line_range_pct = [8.0, 5.0],
            "rescue range must sit between 0.5 % and 50 % with low ≤ high",
        ),
        (
            |s| s.target_range_pct = [6.0, 9.0],
            "top-up range must sit above the rescue range and below 80 %",
        ),
        (
            |s| s.max_rescue_usd = 2.0,
            "max rescue must be at least $5 and within the budget",
        ),
        (|s| s.expires_at = "1000".into(), "the guard has already expired"),
        (
            |s| s.budget_usd = 1000.0,
            "max rescue must be at least $5 and within the budget",
        ),
        (|s| s.cooldown_s = 5, "cooldown must be at least 30 s"),
        (
            |s| s.receipt_pk = "x25519:5e5e".into(),
            "receipt_pk must be x25519: and 32 bytes of hex",
        ),
    ];
    for (change, why) in cases {
        let mut s = settings();
        change(&mut s);
        let out = run(&host, &create_input(&host, &s, GID, GID));
        assert_eq!(out["refused"], why);
    }
}

#[test]
fn outputs_never_carry_a_setting() {
    // T-PRIV-03: whatever happens, the output is a status (and a rule's name when refused), never a value.
    let (host, _net) = common::host(1);
    let mut outs = vec![run(&host, &create_input(&host, &settings(), GID, GID))];
    let mut bad = settings();
    bad.max_rescue_usd = 2.0;
    outs.push(run(&host, &create_input(&host, &bad, "g-bbbbbbbbbb", "g-bbbbbbbbbb")));
    outs.push(run(&host, "not json"));
    for out in outs {
        let text = out.to_string().to_lowercase();
        for secret in [
            &HL[2..].to_lowercase(),
            "1500",
            "4000",
            "nbtc",
            SALT,
            OWNER_SALT,
            "5e5e5e5e5e5e",
        ] {
            assert!(!text.contains(secret), "{text} leaks {secret}");
        }
        assert!(text.len() <= 900);
    }
}

#[test]
fn the_policy_pays_only_the_owner_capped_at_one_rescue() {
    let (host, _net) = common::host(1);
    run(&host, &create_input(&host, &settings(), GID, GID));
    let p = ripcord_checker::actions::policy_for(&host, GID, FEE_WALLET, None).unwrap();
    assert_eq!(p["rules"]["transaction_types"], json!(["confidential"]));
    assert_eq!(p["rules"]["addresses"]["list"], json!([HL.to_lowercase(), FEE_WALLET]));
    assert_eq!(p["rules"]["limits"]["per_transaction"][policy::USDC], "1500000000");
    assert_eq!(p["rules"]["limits"]["daily"][policy::USDC], "4000000000");
    assert_eq!(p["capabilities"]["evm_sign"]["allowed"], false);
}

#[test]
fn an_isolated_btc_guard_caps_the_reserve_token_too() {
    let mut s = settings();
    s.reserve_asset = "nep141:nbtc.bridge.near".into();
    s.isolated = Some(Isolated { coin: "HYPE".into() });
    // 1 BTC = $80,000 → 1e8 sats / 80,000 = 1,250 sats per USD.
    let p = policy::build(&s, FEE_WALLET, Some(policy::ReserveUnits { per_usd: 1_250.0 })).unwrap();
    assert!(
        policy::build(&s, FEE_WALLET, None).is_err(),
        "a non-USDC reserve needs its price"
    );
    assert_eq!(
        p["rules"]["limits"]["per_transaction"]["nep141:nbtc.bridge.near"],
        "2250000"
    );
    assert_eq!(p["capabilities"]["evm_sign"]["allowed"], true);
    assert_eq!(p["capabilities"]["evm_sign"]["raw_tx"], false);
}

#[test]
fn registers_the_guard_with_its_wallet_policy_once() {
    let (host, net) = common::host(1);
    let input = create_input(&host, &settings(), GID, GID);
    assert_eq!(run(&host, &input), json!({ "status": "pending" }));
    {
        let n = net.borrow();
        assert_eq!(n.registered, vec![GID.to_string()]);
        let paths: Vec<&str> = n
            .requests
            .iter()
            .map(|(u, _)| u.rsplit_once(".ai").map_or("rpc", |x| x.1))
            .collect();
        assert_eq!(
            paths,
            [
                "rpc",
                "/register",
                "/wallet/v1/encrypt-policy",
                "/wallet/v1/sign-policy",
                "rpc",
                "rpc"
            ],
            "view, open the wallet, policy, access key, send"
        );
        let (_, sign) = &n.requests[3];
        assert_eq!(
            serde_json::from_str::<Value>(sign).unwrap()["caller"],
            ripcord_checker::config::NET.registry,
            "the wallet signs its policy for the registry, which becomes its controller"
        );
    }
    let stored: StoredGuard = vault::get(&host, &format!("s/{GID}")).unwrap().unwrap();
    assert!(stored.registered.is_some());

    let before = net.borrow().requests.len();
    assert_eq!(run(&host, &input), json!({ "status": "pending" }));
    assert_eq!(
        net.borrow().requests.len(),
        before,
        "a retry after success touches nothing"
    );
}

#[test]
fn the_registry_transaction_carries_hashes_only() {
    // No public link between a guard and its account: the transaction is public, so it holds no setting.
    let (host, net) = common::host(1);
    run(&host, &create_input(&host, &settings(), GID, GID));
    let n = net.borrow();
    let tx = String::from_utf8_lossy(&n.txs[0]).into_owned();
    // borsh: the method name, then the args' u32 length and bytes.
    let raw = &n.txs[0];
    let at = raw.windows(14).position(|w| w == b"register_guard").unwrap() + 14;
    let len = u32::from_le_bytes(raw[at..at + 4].try_into().unwrap()) as usize;
    let args: Value = serde_json::from_slice(&raw[at + 4..at + 4 + len]).unwrap();
    let mut keys: Vec<&str> = args.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "account_commitment",
            "commitment",
            "encrypted_policy",
            "expires_at",
            "guard_id",
            "owner_commitment",
            "wallet_pubkey",
            "wallet_signature"
        ]
    );
    assert_eq!(args["commitment"], commitment(&settings(), SALT).unwrap());
    // The keys above already rule out amounts; these are the values that could slip into a hash's place.
    let text = tx.to_lowercase();
    for secret in [&HL[2..].to_lowercase(), SALT, OWNER_SALT, "9c4e7a1b", "5e5e5e5e5e5e"] {
        assert!(!text.contains(secret), "transaction leaks {secret}");
    }
}

#[test]
fn a_guard_already_on_chain_is_not_registered_twice() {
    let (host, net) = common::host(1);
    net.borrow_mut().registered.push(GID.into());
    assert_eq!(
        run(&host, &create_input(&host, &settings(), GID, GID)),
        json!({ "status": "pending" })
    );
    assert!(net.borrow().txs.is_empty());
}

#[test]
fn a_failed_registration_is_refused_and_retried_next_time() {
    let (host, net) = common::host(1);
    net.borrow_mut().fail_tx = true;
    let input = create_input(&host, &settings(), GID, GID);
    let out = run(&host, &input);
    assert_eq!(out["status"], "skipped");
    assert!(out["refused"].as_str().unwrap().starts_with("transaction failed"));
    let stored: StoredGuard = vault::get(&host, &format!("s/{GID}")).unwrap().unwrap();
    assert!(stored.registered.is_none(), "kept sealed, not marked registered");

    net.borrow_mut().fail_tx = false;
    assert_eq!(run(&host, &input), json!({ "status": "pending" }));
    assert_eq!(net.borrow().registered, vec![GID.to_string()]);
}

#[test]
fn a_wnear_reserve_is_capped_in_wnear_at_the_listed_price() {
    let (host, net) = common::host(1);
    let mut s = settings();
    s.reserve_asset = "nep141:wrap.near".into();
    run(&host, &create_input(&host, &s, GID, GID));
    let n = net.borrow();
    let (_, enc) = n.requests.iter().find(|(u, _)| u.ends_with("/encrypt-policy")).unwrap();
    let p: Value = serde_json::from_str(enc).unwrap();
    assert_eq!(p["wallet_id"], format!("w-{GID}"));
    // $1,500 × 1.2 at $2.50 per NEAR = 720 NEAR (to f64 precision, well inside the 20 % headroom).
    let cap: f64 = p["rules"]["limits"]["per_transaction"]["nep141:wrap.near"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((cap / 1e24 - 720.0).abs() < 1e-9, "{cap}");
}

const ARB_USDC: &str = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";

#[test]
fn funds_a_registered_guard_with_its_sealed_budget() {
    let (host, net) = common::host(1);
    let fund = json!({ "action": "fund", "guard_id": GID, "source_asset": ARB_USDC }).to_string();
    assert_eq!(run(&host, &fund)["refused"], "no such guard");

    net.borrow_mut().fail_tx = true;
    run(&host, &create_input(&host, &settings(), GID, GID));
    assert_eq!(
        run(&host, &fund)["refused"],
        "guard is not registered yet",
        "no money before the policy"
    );

    net.borrow_mut().fail_tx = false;
    run(&host, &create_input(&host, &settings(), GID, GID));
    let out = run(&host, &fund);
    assert_eq!(out, json!({ "status": "pending", "deposit_address": "0xDEP0517" }));
    let n = net.borrow();
    let (_, dep) = n.requests.last().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(dep).unwrap(),
        json!({ "source_asset": ARB_USDC, "amount": "4000000000" }),
        "the budget, from the sealed settings"
    );
}
