//! `check` against a fake Hyperliquid, OutLayer and registry: it arms with a draw sealed to the owner, fires only
//! below the drawn line, pays only the owner's own account within the caps, waits out the cooldown, re-arms, never
//! falls back on an outage, and answers with a bare status.
use ripcord_checker::actions::{run, SealedPayload};
use ripcord_checker::check::Track;
use ripcord_checker::commitment::{account_commitment, commitment, owner_commitment};
use ripcord_checker::host::MockHost;
use ripcord_checker::seal::{open, public_key, seal_with};
use ripcord_checker::types::{GuardSettings, Isolated, Outcome, Preset};
use ripcord_checker::{policy, vault};
use serde_json::{json, Value};

mod common;
use common::{position, state};

const GID: &str = "g-vf6per4bfx";
const HL: &str = "0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3";
const SALT: &str = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f";
const OWNER_SALT: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const RECEIPT_SECRET: [u8; 32] = [9; 32];

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
        receipt_pk: format!("x25519:{}", hex::encode(public_key(&RECEIPT_SECRET))),
        expires_at: "1795046400000000000".into(),
    }
}

fn create(host: &MockHost, s: &GuardSettings) -> Value {
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
        "commitment": commitment(s, SALT).unwrap(),
        "owner_commitment": owner_commitment(&s.owner, OWNER_SALT).unwrap(),
        "account_commitment": account_commitment(&s.hl_address, &s.account_salt).unwrap(),
        "expires_at": s.expires_at, "enc_settings": hex::encode(env),
    });
    run(host, &input.to_string())
}

fn check(host: &MockHost) -> Value {
    run(host, &json!({ "action": "check", "guard_id": GID }).to_string())
}

fn track(host: &MockHost) -> Track {
    vault::get(host, &format!("t/{GID}")).unwrap().unwrap()
}

/// The idempotency keys sent to OutLayer paths ending in `path`, in order.
fn keys(host: &MockHost, path: &str) -> Vec<String> {
    host.headers
        .borrow()
        .iter()
        .filter(|(u, _)| u.ends_with(path))
        .filter_map(|(_, h)| h.iter().find(|(k, _)| k == "X-Idempotency-Key").map(|(_, v)| v.clone()))
        .collect()
}

const FEE_WALLET: &str = "fe1e0000000000000000000000000000000000000000000000000000000000fe";

fn check_fees(host: &MockHost) -> String {
    format!(
        "{:?}",
        ripcord_checker::check::check_with(host, GID, FEE_WALLET).unwrap()
    )
    .to_lowercase()
}

/// A long BTC position at $80,000, its liquidation price `liq`; 40× max leverage.
fn btc(liq: f64) -> Value {
    state(vec![position("BTC", 1.0, 80_000.0, Some(liq), 40, "cross")])
}

/// The args of the n-th signed transaction calling `method` (borsh: the method name, then the args' length).
fn tx_args(txs: &[Vec<u8>], method: &str, n: usize) -> Value {
    let m = method.as_bytes();
    let raw = txs
        .iter()
        .filter(|t| t.windows(m.len()).any(|w| w == m))
        .nth(n)
        .unwrap();
    let at = raw.windows(m.len()).position(|w| w == m).unwrap() + m.len();
    let len = u32::from_le_bytes(raw[at..at + 4].try_into().unwrap()) as usize;
    serde_json::from_slice(&raw[at + 4..at + 4 + len]).unwrap()
}

#[test]
fn waits_until_the_guard_is_registered() {
    let (host, net) = common::host(1);
    net.borrow_mut().fail_tx = true;
    create(&host, &settings());
    assert_eq!(check(&host), json!({ "status": "pending" }));
}

#[test]
fn arms_with_a_draw_only_the_owner_can_open_then_guards() {
    let (host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(74_000.0); // 7.5 % away: above the line
    create(&host, &settings());
    assert_eq!(check(&host), json!({ "status": "guarding" }));
    let n = net.borrow();
    assert_eq!(n.methods, ["register_guard", "record_arm", "set_status"]);
    let arm = tx_args(&n.txs, "record_arm", 0);
    assert_eq!(arm["epoch"], 0);
    let sealed = hex::decode(arm["sealed"].as_str().unwrap()).unwrap();
    let draw: Value = serde_json::from_slice(&open(&RECEIPT_SECRET, &sealed, GID).unwrap()).unwrap();
    assert_eq!(draw, json!({ "epoch": 0, "line": 6.0, "target": 10.0 }));
    assert!(n.withdraws.is_empty());
}

#[test]
fn draws_inside_the_sealed_ranges() {
    let (host, net) = common::host(7);
    net.borrow_mut().hl_state = btc(74_000.0);
    let mut s = settings();
    s.line_range_pct = [4.0, 8.0];
    s.target_range_pct = [9.0, 13.0];
    create(&host, &s);
    check(&host);
    let t = track(&host);
    assert!((4.0..8.0).contains(&t.line) && (9.0..13.0).contains(&t.target), "{t:?}");
}

#[test]
fn fires_below_the_line_and_pays_only_the_owner() {
    let (host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0); // 5 % away: below the 6 % line
    create(&host, &settings());
    assert_eq!(check(&host), json!({ "status": "rescued" }));
    // (10 − 5) % × $80,000 × (1 − 1/80) = $3,950, capped at the $1,500 max rescue.
    assert_eq!(
        net.borrow().withdraws,
        [json!({ "chain": "hypercore", "to": HL, "amount": "1500000000", "token": policy::USDC })]
    );
    let t = track(&host);
    assert_eq!((t.rescues.len(), t.budget_used_usd), (1, 1500.0));
    assert_eq!(t.rescues[0].liq_before, 76_000.0);
}

#[test]
fn one_rescue_per_epoch_then_re_arms_after_the_cooldown() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host, &settings());
    assert_eq!(check(&host)["status"], "rescued");
    host.now_ms += 30_000;
    assert_eq!(check(&host)["status"], "guarding", "credited: the 60 s cooldown starts");
    host.now_ms += 31_000;
    assert_eq!(check(&host)["status"], "guarding", "still inside the cooldown");
    assert_eq!(net.borrow().withdraws.len(), 1);
    host.now_ms += 30_000;
    assert_eq!(
        check(&host)["status"],
        "rescued",
        "a new line after the cooldown, still crossed"
    );
    let t = track(&host);
    assert_eq!((t.epoch, t.rescues.len()), (1, 2));
    assert_eq!(tx_args(&net.borrow().txs, "record_arm", 1)["epoch"], 1);
}

#[test]
fn never_spends_past_the_budget() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host, &settings());
    for _ in 0..5 {
        check(&host);
        host.now_ms += 61_000;
    }
    let amounts: Vec<Value> = net.borrow().withdraws.iter().map(|w| w["amount"].clone()).collect();
    assert_eq!(amounts, ["1500000000", "1500000000", "1000000000"], "$4,000 budget");
    assert_eq!(track(&host).budget_used_usd, 4000.0);
}

#[test]
fn an_outage_pauses_and_never_falls_back() {
    let (host, net) = common::host(2);
    net.borrow_mut().hl_state = btc(76_000.0);
    net.borrow_mut().withdraw_code = 503;
    create(&host, &settings());
    assert_eq!(check(&host)["status"], "skipped", "confidential unavailable: paused");
    assert!(track(&host).rescues.is_empty(), "nothing held while paused");
    net.borrow_mut().withdraw_code = 502;
    assert_eq!(check(&host)["status"], "pending", "upstream hiccup: held under its key");
    net.borrow_mut().withdraw_code = 200;
    assert_eq!(check(&host)["status"], "pending", "sent again under the same key");
    assert_eq!(net.borrow().withdraws.len(), 1);
    assert_eq!(keys(&host, "/confidential/withdraw"), vec![format!("{GID}-0"); 3]);
    let paths: Vec<String> = net
        .borrow()
        .requests
        .iter()
        .map(|(u, _)| u.clone())
        .filter(|u| u.contains("/wallet/v1/") && !u.contains("policy"))
        .collect();
    assert!(
        paths.iter().all(|u| u.ends_with("/confidential/withdraw")),
        "only the confidential route, never a public one: {paths:?}"
    );
}

#[test]
fn speed_aware_fires_before_a_fast_fall_reaches_the_line() {
    for (speed_aware, expected) in [(false, "guarding"), (true, "rescued")] {
        let (mut host, net) = common::host(1);
        let mut s = settings();
        s.speed_aware = speed_aware;
        net.borrow_mut().hl_state = btc(74_000.0); // 7.5 %
        create(&host, &s);
        assert_eq!(check(&host)["status"], "guarding");
        host.now_ms += 30_000;
        net.borrow_mut().hl_state = btc(74_800.0); // 6.5 %: falling 1 point in 30 s, so 2 points in the next 60 s
        assert_eq!(check(&host)["status"], expected, "speed_aware = {speed_aware}");
    }
}

#[test]
fn settles_a_save_when_the_mark_passes_the_old_liquidation_price() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host, &settings());
    check(&host);
    host.now_ms += 10_000;
    // The mark falls to $75,900, past the $76,000 liquidation price from before; the rescue moved it to $70,000.
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 75_900.0, Some(70_000.0), 40, "cross")]);
    check(&host);
    assert_eq!(track(&host).rescues[0].outcome, Outcome::Saved);
}

#[test]
fn an_isolated_guard_watches_only_its_coin() {
    let (host, net) = common::host(1);
    let mut s = settings();
    s.isolated = Some(Isolated { coin: "HYPE".into() });
    net.borrow_mut().hl_state = state(vec![
        position("BTC", 1.0, 80_000.0, Some(79_000.0), 40, "cross"),
        position("HYPE", 100.0, 40.0, Some(30.0), 10, "isolated"),
    ]);
    create(&host, &s);
    assert_eq!(
        check(&host)["status"],
        "guarding",
        "BTC is 1.25 % away, but this guard covers HYPE"
    );
    assert!(net.borrow().withdraws.is_empty());
}

#[test]
fn nothing_at_risk_is_guarding() {
    let (host, net) = common::host(1);
    net.borrow_mut().hl_state = state(vec![position("ETH", 2.0, 3_000.0, None, 25, "cross")]);
    create(&host, &settings());
    assert_eq!(check(&host), json!({ "status": "guarding" }));
}

#[test]
fn answers_with_a_bare_status() {
    // Rule 4 / T-PRIV-03: whatever happens, a check's output is {status} and nothing else.
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    let mut outs = vec![check(&host), run(&host, r#"{"action":"check","guard_id":"nope"}"#)];
    create(&host, &settings());
    for code in [503, 502, 200, 200] {
        net.borrow_mut().withdraw_code = code;
        outs.push(check(&host));
        host.now_ms += 61_000;
    }
    net.borrow_mut().hl_state = Value::String("not a state".into());
    outs.push(check(&host));
    for out in outs {
        let keys: Vec<&String> = out.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["status"], "{out}");
    }
}

#[test]
fn reads_hyperliquid_clearinghouse_state() {
    // The shape Hyperliquid answered on mainnet on Nov 1 (numbers scaled), plus an isolated position with no
    // liquidation price.
    let v: Value = serde_json::from_str(include_str!("fixtures/clearinghouse-state.json")).unwrap();
    let ps = ripcord_checker::hl::parse(&v).unwrap();
    let coins: Vec<&str> = ps.iter().map(|p| p.position.coin.as_str()).collect();
    assert_eq!(coins, ["BTC", "ETH", "SOL", "HYPE"]);
    let btc = &ps[0];
    assert!(btc.position.szi < 0.0 && btc.position.position_value > 0.0);
    assert_eq!(btc.position.liquidation_px, Some(135_420.560_866_418_2));
    assert_eq!(btc.maint_frac(), 1.0 / 40.0);
    assert_eq!(ps[3].position.liquidation_px, None);
    assert_eq!(
        ps[3].position.leverage_type,
        ripcord_checker::types::LeverageType::Isolated
    );
}

#[test]
fn records_the_credit_as_a_rounded_public_receipt_and_a_sealed_exact_one() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host, &settings());
    check(&host); // fires
    net.borrow_mut().polls.push_back("pending_deposit");
    host.now_ms += 10_000;
    assert_eq!(
        check(&host)["status"],
        "pending",
        "still settling: read, never resubmitted"
    );
    host.now_ms += 17_000;
    assert_eq!(check(&host)["status"], "guarding", "credited");
    assert_eq!(net.borrow().withdraws.len(), 1);
    let n = net.borrow();
    let r = tx_args(&n.txs, "record_rescue", 0);
    assert_eq!(r["public"]["credit_usd"], 1500.0);
    assert_eq!(r["public"]["at_hour"].as_u64().unwrap() % 3600, 0, "a whole hour");
    assert_eq!(r["public"]["latency_s"], 27);
    let sealed = hex::decode(r["sealed"].as_str().unwrap()).unwrap();
    let exact: Value = serde_json::from_slice(&open(&RECEIPT_SECRET, &sealed, GID).unwrap()).unwrap();
    assert_eq!(
        (exact["amount_usd"].as_f64(), exact["hl_tx"].as_str()),
        (Some(1500.0), Some("0xhlreq-1"))
    );
    assert!(
        !r.to_string().to_lowercase().contains(&HL[2..].to_lowercase()),
        "no address in the transaction"
    );
}

#[test]
fn a_refund_fires_again_under_a_fresh_key_then_gives_the_budget_back() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host, &settings());
    check(&host);
    net.borrow_mut().polls.extend(["refunded", "refunded", "refunded"]);
    for _ in 0..3 {
        host.now_ms += 5_000;
        check(&host);
    }
    // Given up after two refires, the budget comes back and a new epoch fires again: the position is still at risk.
    let k = keys(&host, "/confidential/withdraw");
    assert_eq!(
        k,
        [
            format!("{GID}-0"),
            format!("{GID}-0-r1"),
            format!("{GID}-0-r2"),
            format!("{GID}-1")
        ]
    );
    let t = track(&host);
    assert_eq!(t.rescues[0].stage, ripcord_checker::check::Stage::Failed);
    assert_eq!(
        t.budget_used_usd, 1500.0,
        "only the new rescue holds budget; the refunded one costs nothing"
    );
}

#[test]
fn a_busy_wallet_waits_and_sends_the_same_key() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    net.borrow_mut().withdraw_code = 409;
    create(&host, &settings());
    assert_eq!(check(&host)["status"], "pending");
    net.borrow_mut().withdraw_code = 200;
    host.now_ms += 3_000;
    assert_eq!(check(&host)["status"], "pending");
    assert_eq!(
        keys(&host, "/confidential/withdraw"),
        [format!("{GID}-0"), format!("{GID}-0")]
    );
    assert_eq!(net.borrow().withdraws.len(), 1);
}

#[test]
fn a_wnear_reserve_swaps_to_usdc_inside_the_confidential_balance_first() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    let mut s = settings();
    s.reserve_asset = "nep141:wrap.near".into();
    create(&host, &s);
    assert_eq!(check(&host)["status"], "rescued");
    let swap = net.borrow().swaps[0].clone();
    assert_eq!(
        (swap["token_in"].as_str(), swap["token_out"].as_str()),
        (Some("nep141:wrap.near"), Some(policy::USDC))
    );
    assert_eq!(swap["min_amount_out"], "1470000000", "98 % of the $1,500 rescue");
    // $1,500 × 1.03 at $2.50 a NEAR: 618 NEAR, to f64 precision.
    let sold: f64 = swap["amount_in"].as_str().unwrap().parse().unwrap();
    assert!((sold / 1e24 - 618.0).abs() < 1e-6, "{sold}");
    assert!(
        net.borrow().withdraws.is_empty(),
        "nothing leaves before the swap fills"
    );
    host.now_ms += 10_000;
    assert_eq!(check(&host)["status"], "pending", "the fill goes to Hyperliquid");
    assert_eq!(net.borrow().withdraws[0]["amount"], "1470000000");
    assert_eq!(keys(&host, "/confidential/withdraw"), [format!("{GID}-0-w")]);
}

#[test]
fn a_save_pays_its_fee_and_is_recorded() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host, &settings());
    check_fees(&host); // fires (and charges this month's $1)
    host.now_ms += 20_000;
    check_fees(&host); // credited
    host.now_ms += 10_000;
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 75_900.0, Some(70_000.0), 40, "cross")]);
    check_fees(&host); // saved
    let n = net.borrow();
    let fees: Vec<(&str, &str)> = n
        .transfers
        .iter()
        .map(|t| (t["to"].as_str().unwrap(), t["amount"].as_str().unwrap()))
        .collect();
    assert_eq!(
        fees,
        [(FEE_WALLET, "1000000"), (FEE_WALLET, "45000000")],
        "$1 this month, then 3 % of $1,500"
    );
    let o = tx_args(&n.txs, "record_outcome", 0);
    assert_eq!((o["index"].as_u64(), o["outcome"].as_str()), (Some(0), Some("Saved")));
    assert_eq!(o["saved_at_hour"].as_u64().unwrap() % 3600, 0);
    drop(n);
    assert_eq!(keys(&host, "/confidential/transfer")[1], format!("{GID}-fee-0"));
}

#[test]
fn an_unneeded_rescue_is_early_and_free() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(76_000.0);
    create(&host, &settings());
    check_fees(&host);
    host.now_ms += 20_000;
    check_fees(&host);
    net.borrow_mut().hl_state = state(vec![position("BTC", 1.0, 90_000.0, Some(70_000.0), 40, "cross")]);
    host.now_ms += 86_400_000;
    check_fees(&host);
    let n = net.borrow();
    assert_eq!(tx_args(&n.txs, "record_outcome", 0)["outcome"], "Early");
    assert!(
        n.transfers.iter().all(|t| t["amount"] == "1000000"),
        "monthly fees only, no save fee"
    );
}

#[test]
fn the_monthly_fee_is_charged_once_a_month_and_never_without_a_fee_wallet() {
    let (mut host, net) = common::host(1);
    net.borrow_mut().hl_state = btc(70_000.0); // far: no rescue
    let mut s = settings();
    s.expires_at = "1830297600000000000".into(); // 2028, so the guard outlives the month
    create(&host, &s);
    check(&host); // the compiled-in fee wallet is unset: no fees
    assert!(net.borrow().transfers.is_empty());
    check_fees(&host);
    host.now_ms += 3_600_000;
    check_fees(&host);
    assert_eq!(net.borrow().transfers.len(), 1);
    host.now_ms += 31 * 86_400_000;
    check_fees(&host);
    let k = keys(&host, "/confidential/transfer");
    assert_eq!(k.len(), 2);
    assert!(k[0].starts_with(&format!("{GID}-month-")) && k[0] != k[1], "{k:?}");
}

#[test]
fn months_follow_the_calendar() {
    use ripcord_checker::check::month_of;
    assert_eq!(month_of(1_793_491_140_000), "2026-10"); // Oct 31 2026 23:59 UTC
    assert_eq!(month_of(1_793_491_200_000), "2026-11"); // Nov 1 2026 00:00 UTC
    assert_eq!(month_of(951_825_600_000), "2000-02"); // Feb 29 2000
}
