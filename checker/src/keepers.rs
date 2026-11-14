//! The open keeper network (feature `keepers`, not in the published builds). Anyone may run a poker and name itself
//! on its check calls: `{"action":"check","guard_id":…,"keeper":"<NEAR account>"}`. The check itself is exactly
//! `check::check_with`'s: a keeper only asks, the enclave alone decides to rescue, and the answer is still a bare
//! status. When a keeper's check is the one that fires a rescue, the enclave remembers that keeper in its vault; once
//! the rescue's receipt is on the registry it credits the keeper in the keeper-market contract, which pays a bounty
//! per rescue and credits each rescue at most once. A credit that fails never touches the rescue: a later check tries
//! it again.
use crate::actions::CHECKER_KEY;
use crate::check::{self, Opts, Track};
use crate::config::{canary_on, NET};
use crate::host::Host;
use crate::near_tx::{self, FunctionCall};
use crate::registry::TGAS;
use crate::vault;
use ripcord_rules::types::CheckStatus;
use serde_json::{json, Value};

/// The keeper-market contract this build credits. Without one, keepers are remembered but nothing is sent.
pub const MARKET: Option<&str> = option_env!("RIPCORD_KEEPER_MARKET");
const CREDIT_GAS: u64 = 10 * TGAS;

/// A NEAR account id: 2–64 characters of lowercase letters and digits, separated by single `-`, `_` or `.`.
pub fn is_account_id(s: &str) -> bool {
    let b = s.as_bytes();
    let sep = |c: u8| matches!(c, b'-' | b'_' | b'.');
    (2..=64).contains(&b.len())
        && b.iter()
            .all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || sep(c))
        && !sep(b[0])
        && !sep(b[b.len() - 1])
        && !b.windows(2).any(|w| sep(w[0]) && sep(w[1]))
}

/// The enclave's entry in a keepers build: a check may name its keeper; every other action goes to `otherwise`
/// (`actions::run`).
pub fn run(host: &dyn Host, input: &str, otherwise: fn(&dyn Host, &str) -> Value) -> Value {
    let Ok(v) = serde_json::from_str::<Value>(input) else {
        return otherwise(host, input);
    };
    let (Some("check"), Some(guard_id)) = (v["action"].as_str(), v["guard_id"].as_str()) else {
        return otherwise(host, input);
    };
    let o = Opts {
        fee_wallet: NET.fee_wallet,
        canary: canary_on(),
    };
    let status = check_with(host, guard_id, v["keeper"].as_str(), &o, MARKET);
    json!({ "status": status.unwrap_or(CheckStatus::Skipped) })
}

/// A rescue's identity: its epoch and the moment it fired.
fn rescue_ids(host: &dyn Host, guard_id: &str) -> Vec<String> {
    vault::get::<Track>(host, &format!("t/{guard_id}"))
        .ok()
        .flatten()
        .map(|t| t.rescues.iter().map(|r| format!("{}-{}", r.epoch, r.at_ms)).collect())
        .unwrap_or_default()
}

/// `check::check_with`, remembering the keeper whose call fired a rescue and crediting rescues already on the
/// registry. Its result is the check's own.
pub fn check_with(
    host: &dyn Host,
    guard_id: &str,
    keeper: Option<&str>,
    o: &Opts,
    market: Option<&str>,
) -> Result<CheckStatus, String> {
    let before = rescue_ids(host, guard_id);
    let status = check::check_with(host, guard_id, o);
    if let (Some(k), Ok(_)) = (keeper.filter(|k| is_account_id(k)), &status) {
        for id in rescue_ids(host, guard_id).into_iter().filter(|id| !before.contains(id)) {
            // Losing this only costs the keeper its credit; the rescue already happened.
            let _ = vault::put(host, &format!("k/{guard_id}/{id}"), &k.to_string());
        }
    }
    if let Some(m) = market {
        credit_due(host, guard_id, m);
    }
    status
}

/// Credits every keeper whose rescue now has a registry receipt and hasn't been credited yet.
fn credit_due(host: &dyn Host, guard_id: &str, market: &str) {
    let Ok(Some(t)) = vault::get::<Track>(host, &format!("t/{guard_id}")) else {
        return;
    };
    for r in &t.rescues {
        let Some(index) = r.receipt else { continue };
        let Ok(Some(keeper)) = vault::get::<String>(host, &format!("k/{guard_id}/{}-{}", r.epoch, r.at_ms)) else {
            continue;
        };
        let done = format!("kc/{guard_id}/{index}");
        if matches!(vault::get::<bool>(host, &done), Ok(Some(true))) {
            continue;
        }
        match credit(host, market, guard_id, index, &keeper) {
            // The market credits each rescue once, so "already credited" means an earlier try landed.
            Ok(_) => {
                let _ = vault::put(host, &done, &true);
            }
            Err(e) if e.contains("already credited") => {
                let _ = vault::put(host, &done, &true);
            }
            Err(_) => {}
        }
    }
}

/// `credit(guard_id, receipt_index, keeper)` on the market, signed by the checker's own enclave key.
fn credit(host: &dyn Host, market: &str, guard_id: &str, index: u32, keeper: &str) -> Result<String, String> {
    let pk = host.public_key(CHECKER_KEY)?;
    let account = hex::encode(pk);
    let (nonce, block_hash) = near_tx::access_key(host, NET.rpc, &account, &pk)?;
    let args = json!({ "guard_id": guard_id, "receipt_index": index, "keeper": keeper }).to_string();
    near_tx::send(
        host,
        NET.rpc,
        CHECKER_KEY,
        &FunctionCall {
            signer_id: &account,
            public_key: pk,
            nonce,
            receiver_id: market,
            block_hash,
            method: "credit",
            args: args.as_bytes(),
            gas: CREDIT_GAS,
            deposit: 0,
        },
    )
}
