//! The guard wallet's policy (docs/SPEC.md §3), enforced by OutLayer's keystore whatever this code does: only
//! confidential operations, only to the owner's Hyperliquid address, the close address and Ripcord's fee wallet,
//! at most one rescue per transaction and the budget per day.
use ripcord_rules::types::GuardSettings;
use serde_json::{json, Value};

/// Native USDC on NEAR, the unit of a rescue.
pub const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

pub struct ReserveUnits {
    /// Smallest units of the reserve asset per USD, from the price at creation.
    pub per_usd: f64,
}

pub fn build(s: &GuardSettings, fee_wallet: &str, reserve: Option<ReserveUnits>) -> Result<Value, &'static str> {
    let mut list = vec![s.hl_address.to_ascii_lowercase()];
    if let Some(c) = &s.close_hint {
        list.push(c.address.clone());
    }
    list.push(fee_wallet.to_string());

    let usd = |x: f64| ((x * 1e6).round() as u128).to_string();
    let mut per_tx = serde_json::Map::new();
    per_tx.insert(USDC.into(), json!(usd(s.max_rescue_usd)));
    if s.reserve_asset != USDC {
        // A rescue from a non-USDC reserve spends the reserve token first (swap), so it gets its own cap,
        // with 20 % headroom for the price moving between creation and the rescue.
        let r = reserve.ok_or("a non-USDC reserve needs its price")?;
        per_tx.insert(
            s.reserve_asset.clone(),
            json!(((s.max_rescue_usd * 1.2 * r.per_usd).ceil() as u128).to_string()),
        );
    }

    Ok(json!({
        "rules": {
            "transaction_types": ["confidential"],
            "addresses": { "mode": "whitelist", "list": list },
            "limits": {
                "per_transaction": per_tx,
                "daily": { USDC: usd(s.budget_usd) },
            },
        },
        "capabilities": {
            "confidential": { "allowed": true },
            "evm_sign": { "allowed": s.isolated.is_some(), "raw_tx": false },
            "solana_sign": { "allowed": false },
        },
    }))
}
