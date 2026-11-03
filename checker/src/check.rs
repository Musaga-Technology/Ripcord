//! One `check` (docs/SPEC.md §3): read Hyperliquid inside the TEE, settle earlier rescues, re-arm after the
//! cooldown, fire below the drawn line, and rescue with USDC to the owner's own account. Pokers only say "check
//! now"; nothing here comes from input except the guard id. The output is a bare status (rule 4).
use crate::actions::StoredGuard;
use crate::config::{HISTORY_S, HORIZON_S, NET};
use crate::custody::{Custody, Withdraw};
use crate::host::Host;
use crate::registry::{self, TGAS};
use crate::{hl, policy, settings, vault};
use ripcord_rules::commitment::is_guard_id;
use ripcord_rules::guard::{
    distance_pct, draw, fall_rate, mark_of, rescue_size, settle, should_fire, speed_target, SizeInput,
};
use ripcord_rules::seal;
use ripcord_rules::types::{CheckStatus, LeverageType, Outcome};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// The guard's moving state, sealed in the vault under `t/<guard_id>`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Track {
    pub epoch: u64,
    /// This epoch's drawn rescue line and top-up target, inside the sealed ranges.
    pub line: f64,
    pub target: f64,
    /// Whether the registry has been told the guard is guarding.
    pub guarding: bool,
    /// (seconds, distance %) over the last `HISTORY_S`, for the fall rate.
    pub history: Vec<(f64, f64)>,
    pub rescues: Vec<Rescue>,
    pub budget_used_usd: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Rescue {
    pub epoch: u64,
    pub coin: String,
    pub szi: f64,
    /// The liquidation price before the rescue: crossing it later is a save.
    pub liq_before: f64,
    pub at_ms: u64,
    pub amount_usd: f64,
    pub request_id: String,
    pub outcome: Outcome,
}

/// u ∈ [0, 1) from the host's randomness (53 bits).
fn uniform(host: &dyn Host) -> f64 {
    let b: [u8; 8] = host.random(8).try_into().unwrap_or([0; 8]);
    (u64::from_le_bytes(b) >> 11) as f64 / (1u64 << 53) as f64
}

/// Draws this epoch's line and target and records the arm on the registry, sealed to the owner's receipt key so
/// only the owner can later show which line was in force (compensation evidence).
fn arm(host: &dyn Host, guard_id: &str, g: &StoredGuard, epoch: u64) -> Result<(f64, f64), String> {
    let s = &g.settings;
    let line = draw(s.line_range_pct[0], s.line_range_pct[1], uniform(host));
    let target = draw(s.target_range_pct[0], s.target_range_pct[1], uniform(host));
    let owner = settings::receipt_key(s).ok_or("receipt key is malformed")?;
    let eph: [u8; 32] = host.random(32).try_into().map_err(|_| "randomness")?;
    let nonce: [u8; 12] = host.random(12).try_into().map_err(|_| "randomness")?;
    let plain = json!({ "epoch": epoch, "line": line, "target": target }).to_string();
    let sealed = hex::encode(seal::seal_with(&eph, &nonce, &owner, plain.as_bytes(), guard_id));
    registry::call(
        host,
        "record_arm",
        &json!({ "guard_id": guard_id, "epoch": epoch, "sealed": sealed }),
        30 * TGAS,
        0,
    )?;
    Ok((line, target))
}

pub fn check(host: &dyn Host, guard_id: &str) -> Result<CheckStatus, String> {
    if !is_guard_id(guard_id) {
        return Err("invalid guard_id".into());
    }
    let g: StoredGuard = vault::get(host, &format!("s/{guard_id}"))?.ok_or("no such guard")?;
    if g.registered.is_none() {
        return Ok(CheckStatus::Pending);
    }
    let s = &g.settings;
    let now = host.now_ms();
    let expires_ms = s.expires_at.parse::<u128>().map_err(|_| "expires_at")? / 1_000_000;
    if expires_ms <= now as u128 {
        return Ok(CheckStatus::Skipped);
    }

    let key = format!("t/{guard_id}");
    let mut t = match vault::get::<Track>(host, &key)? {
        Some(t) => t,
        None => {
            let (line, target) = arm(host, guard_id, &g, 0)?;
            let t = Track {
                epoch: 0,
                line,
                target,
                guarding: false,
                history: vec![],
                rescues: vec![],
                budget_used_usd: 0.0,
            };
            vault::put(host, &key, &t)?;
            t
        }
    };
    if !t.guarding {
        registry::call(
            host,
            "set_status",
            &json!({ "guard_id": guard_id, "status": "Guarding" }),
            30 * TGAS,
            0,
        )?;
        t.guarding = true;
        vault::put(host, &key, &t)?;
    }

    let positions = hl::positions(host, NET.hyperliquid, &s.hl_address)?;
    let now_s = now as f64 / 1000.0;

    // Settle earlier rescues against the mark. A position that is gone was closed or liquidated; telling the two
    // apart needs the account's fills (Day 5), so it stays pending until then.
    for r in t.rescues.iter_mut().filter(|r| r.outcome == Outcome::Pending) {
        if let Some(p) = positions.iter().find(|p| p.position.coin == r.coin) {
            let age = now.saturating_sub(r.at_ms) as f64 / 1000.0;
            r.outcome = settle(r.szi, r.liq_before, mark_of(&p.position), false, age);
        }
    }

    // The riskiest position the guard covers: the isolated coin, or the nearest cross position.
    let iso = s.isolated.as_ref().map(|i| i.coin.as_str());
    let riskiest = positions
        .iter()
        .filter(|p| match iso {
            Some(c) => p.position.coin == c,
            None => p.position.leverage_type == LeverageType::Cross,
        })
        .filter_map(|p| distance_pct(p.position.liquidation_px, mark_of(&p.position)).map(|d| (d, p)))
        .min_by(|a, b| a.0.total_cmp(&b.0));
    let Some((distance, p)) = riskiest else {
        t.history.clear();
        vault::put(host, &key, &t)?;
        return Ok(CheckStatus::Guarding);
    };
    t.history.retain(|(ts, _)| now_s - ts <= HISTORY_S);
    let v = fall_rate(&t.history, now_s, distance, HISTORY_S);
    t.history.push((now_s, distance));

    // One rescue per epoch: wait out the cooldown, then draw a new line.
    if let Some(last) = t.rescues.last().filter(|r| r.epoch == t.epoch) {
        if now < last.at_ms + s.cooldown_s * 1000 {
            vault::put(host, &key, &t)?;
            return Ok(CheckStatus::Guarding);
        }
        let (line, target) = arm(host, guard_id, &g, t.epoch + 1)?;
        (t.epoch, t.line, t.target) = (t.epoch + 1, line, target);
        vault::put(host, &key, &t)?;
    }

    if !should_fire(distance, t.line, s.speed_aware, v, HORIZON_S) {
        vault::put(host, &key, &t)?;
        return Ok(CheckStatus::Guarding);
    }
    let budget_left = (s.budget_usd - t.budget_used_usd).max(0.0);
    let size = rescue_size(&SizeInput {
        // Fast falls get a bigger top-up: past the target by the fall expected while the credit lands.
        drawn_target: speed_target(t.target, s.speed_aware, v, HORIZON_S),
        distance,
        mark: mark_of(&p.position),
        szi: p.position.szi,
        maint_frac: p.maint_frac(),
        max_rescue_usd: s.max_rescue_usd,
        budget_left_usd: budget_left,
        // The reserve's own balance is read with the executor (Day 5); the budget bounds it until then.
        reserve_usd: budget_left,
    });
    let Some(amount) = size else {
        vault::put(host, &key, &t)?;
        return Ok(CheckStatus::Guarding);
    };
    if s.reserve_asset != policy::USDC {
        // A non-USDC reserve swaps first (`/confidential/swap`), with the executor on Day 5.
        vault::put(host, &key, &t)?;
        return Ok(CheckStatus::Skipped);
    }

    let units = ((amount * 1e6).floor() as u128).to_string();
    let custody = Custody::new(host, NET.outlayer_api)?;
    let idem = format!("{guard_id}-{}", t.epoch);
    let status = match custody.withdraw(guard_id, &s.hl_address, &units, policy::USDC, &idem)? {
        Withdraw::Accepted(request_id) => {
            t.rescues.push(Rescue {
                epoch: t.epoch,
                coin: p.position.coin.clone(),
                szi: p.position.szi,
                liq_before: p.position.liquidation_px.unwrap_or_default(),
                at_ms: now,
                amount_usd: amount,
                request_id,
                outcome: Outcome::Pending,
            });
            t.budget_used_usd += amount;
            CheckStatus::Rescued
        }
        // The next check sends the same key again: harmless if this one was taken after all.
        Withdraw::Retry => CheckStatus::Pending,
        Withdraw::Unavailable => CheckStatus::Skipped,
    };
    vault::put(host, &key, &t)?;
    Ok(status)
}
