//! What the checker accepts as a guard's sealed settings before it opens a wallet for them. Refusal reasons name the
//! rule, never the value, so a refusal can't leak a setting.
use ripcord_rules::types::GuardSettings;

fn is_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn validate(s: &GuardSettings, now_ms: u64) -> Result<(), &'static str> {
    let [lo, hi] = s.line_range_pct;
    let [tlo, thi] = s.target_range_pct;
    if !is_address(&s.hl_address) {
        return Err("hl_address must be an EVM address");
    }
    if !(0.5..=50.0).contains(&lo) || lo > hi || hi > 50.0 {
        return Err("rescue range must sit between 0.5 % and 50 % with low ≤ high");
    }
    if tlo <= hi || tlo > thi || thi > 80.0 {
        return Err("top-up range must sit above the rescue range and below 80 %");
    }
    if s.max_rescue_usd < 5.0 || s.budget_usd < s.max_rescue_usd {
        return Err("max rescue must be at least $5 and within the budget");
    }
    if s.cooldown_s < 30 {
        return Err("cooldown must be at least 30 s");
    }
    if s.reserve_asset.is_empty() || !s.reserve_asset.contains(':') {
        return Err("reserve_asset must be a 1Click asset id");
    }
    let expires_ms = s
        .expires_at
        .parse::<u128>()
        .map_err(|_| "expires_at must be nanoseconds")?
        / 1_000_000;
    if expires_ms <= now_ms as u128 {
        return Err("the guard has already expired");
    }
    if let Some(c) = &s.close_hint {
        if c.address.is_empty() || c.chain.is_empty() {
            return Err("close_hint needs a chain and an address");
        }
    }
    Ok(())
}
