//! Hyperliquid, read by the checker itself inside the TEE (ARCHITECTURE §2 rule 3): `clearinghouseState` only
//! (weight 2). Numbers arrive as strings; `liquidationPx` is null when nothing can be liquidated. Shape as read from
//! mainnet on Nov 1 2026.
use crate::host::Host;
use ripcord_rules::types::{LeverageType, Position};
use serde_json::{json, Value};

pub struct HlPosition {
    pub position: Position,
    /// The coin's maximum leverage: maintenance margin is half the initial margin at it, so the fraction is
    /// 1 / (2 × maxLeverage), without a `meta` read (weight 20).
    pub max_leverage: f64,
}

impl HlPosition {
    pub fn maint_frac(&self) -> f64 {
        1.0 / (2.0 * self.max_leverage)
    }
}

fn num(v: &Value) -> Option<f64> {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_f64())
}

pub fn parse(state: &Value) -> Result<Vec<HlPosition>, String> {
    let list = state["assetPositions"]
        .as_array()
        .ok_or("clearinghouseState has no assetPositions")?;
    list.iter()
        .map(|a| {
            let p = &a["position"];
            let leverage_type = match p["leverage"]["type"].as_str() {
                Some("cross") => LeverageType::Cross,
                Some("isolated") => LeverageType::Isolated,
                _ => return Err("unknown leverage type".to_string()),
            };
            Ok(HlPosition {
                position: Position {
                    coin: p["coin"].as_str().ok_or("position has no coin")?.to_string(),
                    szi: num(&p["szi"]).ok_or("position has no szi")?,
                    position_value: num(&p["positionValue"]).ok_or("position has no value")?,
                    liquidation_px: num(&p["liquidationPx"]),
                    leverage_type,
                },
                max_leverage: num(&p["maxLeverage"])
                    .filter(|l| *l >= 1.0)
                    .ok_or("position has no maxLeverage")?,
            })
        })
        .filter(|p| p.as_ref().map_or(true, |p| p.position.szi != 0.0))
        .collect()
}

fn info(host: &dyn Host, api: &str, body: &Value) -> Result<Value, String> {
    let (code, raw) = host.http(
        "POST",
        &format!("{api}/info"),
        &[("Content-Type", "application/json".into())],
        Some(body.to_string().as_bytes()),
    )?;
    if code != 200 {
        return Err(format!("hyperliquid: HTTP {code}"));
    }
    serde_json::from_slice(&raw).map_err(|_| "hyperliquid: not JSON".into())
}

pub fn positions(host: &dyn Host, api: &str, user: &str) -> Result<Vec<HlPosition>, String> {
    parse(&info(
        host,
        api,
        &json!({ "type": "clearinghouseState", "user": user }),
    )?)
}

/// A coin's asset number: its place in the perps universe (`meta`, weight 20, so only when a rescue needs it).
pub fn asset_index(host: &dyn Host, api: &str, coin: &str) -> Result<u32, String> {
    let meta = info(host, api, &json!({ "type": "meta" }))?;
    let universe = meta["universe"].as_array().ok_or("meta has no universe")?;
    universe
        .iter()
        .position(|a| a["name"] == coin)
        .map(|i| i as u32)
        .ok_or_else(|| "coin is not in the perps universe".into())
}

/// Has the owner approved this agent, and is the approval still good? (`extraAgents`, read Nov 5 2026:
/// a list of `{name, address, validUntil}`.)
pub fn agent_approved(host: &dyn Host, api: &str, user: &str, agent: &str, now_ms: u64) -> Result<bool, String> {
    let list = info(host, api, &json!({ "type": "extraAgents", "user": user }))?;
    let list = list.as_array().ok_or("extraAgents is not a list")?;
    Ok(list.iter().any(|a| {
        a["address"].as_str().is_some_and(|x| x.eq_ignore_ascii_case(agent))
            && a["validUntil"].as_u64().is_none_or(|until| until > now_ms)
    }))
}
