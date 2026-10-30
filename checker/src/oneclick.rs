//! 1Click's public token list (`GET /v0/tokens`: assetId, decimals, price in USD), used to cap a non-USDC
//! reserve in its own units and to size a deposit. Fields as read by the Oct 2026 dry quotes.
use crate::host::Host;
use serde_json::Value;

pub struct Token {
    pub decimals: u32,
    pub price_usd: f64,
}

impl Token {
    /// Smallest units per USD.
    pub fn per_usd(&self) -> f64 {
        10f64.powi(self.decimals as i32) / self.price_usd
    }
}

pub fn token(host: &dyn Host, base: &str, asset_id: &str) -> Result<Token, String> {
    let (code, raw) = host.http("GET", &format!("{base}/v0/tokens"), &[], None)?;
    if code != 200 {
        return Err(format!("token list: HTTP {code}"));
    }
    let list: Vec<Value> = serde_json::from_slice(&raw).map_err(|_| "token list is not JSON")?;
    let t = list
        .iter()
        .find(|t| t["assetId"] == asset_id)
        .ok_or("asset is not listed by 1Click")?;
    match (t["decimals"].as_u64(), t["price"].as_f64()) {
        (Some(d), Some(p)) if p > 0.0 => Ok(Token {
            decimals: d as u32,
            price_usd: p,
        }),
        _ => Err("asset has no price".into()),
    }
}
