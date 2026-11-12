//! One `check` (docs/SPEC.md §3): read Hyperliquid inside the TEE, move an in-flight rescue along, settle earlier
//! rescues and charge their fees, re-arm after the cooldown, fire below the drawn line, and rescue with USDC to the
//! owner's own account. Pokers only say "check now"; nothing here comes from input except the guard id. The output
//! is a bare status (rule 4).
//!
//! The rescue executor follows ARCHITECTURE §8 across checks rather than waiting inside one: 502 and `wallet_busy`
//! send the same key again next time, `processing` is read, never resubmitted, a refund fires again under a fresh
//! key, and 503 pauses with no public fallback.
use crate::actions::{self, StoredGuard};
use crate::agent::{self, Moved};
use crate::config::{canary_on, fees_on, HISTORY_S, HORIZON_S, MAX_MARGIN_TRIES, MAX_REFIRES, MONTHLY_FEE_UNITS, NET};
use crate::custody::{Custody, Op, Request};
use crate::host::Host;
use crate::registry::{self, TGAS};
use crate::{hl, oneclick, policy, settings, vault};
use ripcord_rules::commitment::is_guard_id;
use ripcord_rules::guard::{
    at_hour, distance_pct, draw, fall_rate, latency_s, mark_of, rescue_size, round_credit, save_fee, settle,
    should_fire, speed_target, SizeInput, MIN_RESCUE_USD,
};
use ripcord_rules::seal;
use ripcord_rules::types::{CheckStatus, LeverageType, Outcome};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    /// Receipts recorded on the registry so far: the next one's index.
    #[serde(default)]
    pub receipts: u32,
    /// The month ("YYYY-MM") whose $1 guard fee has been charged.
    #[serde(default)]
    pub fee_month: Option<String>,
    /// When the hourly dry-run canary last passed.
    #[serde(default)]
    pub canary_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub enum Stage {
    /// A non-USDC reserve being swapped to USDC inside the confidential balance.
    Swapping,
    /// USDC on its way to the owner's Hyperliquid account.
    Withdrawing,
    Credited,
    /// Refunded too often, or failed: the budget is given back.
    Failed,
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
    pub stage: Stage,
    /// The current attempt's idempotency key, and its request once OutLayer took it.
    pub key: String,
    pub request_id: Option<String>,
    pub refires: u32,
    /// The swap's input and floor (non-USDC reserves), then the USDC withdrawn, in smallest units.
    pub swap_in: Option<String>,
    pub swap_min_out: Option<String>,
    pub usdc_units: String,
    pub credited_usd: Option<f64>,
    pub credited_ms: Option<u64>,
    pub hl_tx: Option<String>,
    /// Its index on the registry, once recorded.
    pub receipt: Option<u32>,
    pub outcome: Outcome,
    pub fee_sent: bool,
    pub outcome_recorded: bool,
    /// Isolated guards: the credit moved into the position, the nonce of the move in flight, and the tries so far.
    #[serde(default)]
    pub margin_moved: bool,
    #[serde(default)]
    pub margin_nonce: Option<u64>,
    #[serde(default)]
    pub margin_tries: u32,
}

/// u ∈ [0, 1) from the host's randomness (53 bits).
fn uniform(host: &dyn Host) -> f64 {
    let b: [u8; 8] = host.random(8).try_into().unwrap_or([0; 8]);
    (u64::from_le_bytes(b) >> 11) as f64 / (1u64 << 53) as f64
}

/// Seals `plain` to the owner's receipt key, bound to the guard: only the owner can open it.
pub fn seal_to_owner(host: &dyn Host, guard_id: &str, g: &StoredGuard, plain: &Value) -> Result<String, String> {
    let owner = settings::receipt_key(&g.settings).ok_or("receipt key is malformed")?;
    let eph: [u8; 32] = host.random(32).try_into().map_err(|_| "randomness")?;
    let nonce: [u8; 12] = host.random(12).try_into().map_err(|_| "randomness")?;
    Ok(hex::encode(seal::seal_with(
        &eph,
        &nonce,
        &owner,
        plain.to_string().as_bytes(),
        guard_id,
    )))
}

/// Draws this epoch's line and target and records the arm on the registry, sealed to the owner so only the owner
/// can later show which line was in force (compensation evidence).
pub fn arm(host: &dyn Host, guard_id: &str, g: &StoredGuard, epoch: u64) -> Result<(f64, f64), String> {
    let s = &g.settings;
    let line = draw(s.line_range_pct[0], s.line_range_pct[1], uniform(host));
    let target = draw(s.target_range_pct[0], s.target_range_pct[1], uniform(host));
    let sealed = seal_to_owner(
        host,
        guard_id,
        g,
        &json!({ "epoch": epoch, "line": line, "target": target }),
    )?;
    registry::call(
        host,
        "record_arm",
        &json!({ "guard_id": guard_id, "epoch": epoch, "sealed": sealed }),
        30 * TGAS,
        0,
    )?;
    Ok((line, target))
}

/// "YYYY-MM" for a time in ms (civil calendar from days since 1970, Howard Hinnant's algorithm).
pub fn month_of(ms: u64) -> String {
    let z = (ms / 86_400_000) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}")
}

/// What the reserve can pay right now, in USD. A rescue sized past it would be refused, given back and fired again
/// on every check, so it never would land. A non-USDC reserve sells 3 % more than the rescue, so it counts for less.
fn payable_usd(balances: &[(String, String)], asset: &str, tok: Option<&oneclick::Token>) -> f64 {
    let units = balances
        .iter()
        .find(|(t, _)| t == asset)
        .and_then(|(_, b)| b.parse::<u128>().ok())
        .unwrap_or(0) as f64;
    match tok {
        None => units / 1e6,
        Some(t) => units / t.per_usd() / 1.03,
    }
}

/// True when the reserve's USDC covers the monthly fee and still the smallest rescue.
fn spares_fee(balances: &[(String, String)]) -> bool {
    let usdc = balances
        .iter()
        .find(|(t, _)| t == policy::USDC)
        .and_then(|(_, b)| b.parse::<u128>().ok())
        .unwrap_or(0);
    usdc >= MONTHLY_FEE_UNITS + (MIN_RESCUE_USD * 1e6) as u128
}

/// Sends the rescue's current leg under its current key.
fn send(custody: &Custody, guard_id: &str, g: &StoredGuard, r: &Rescue) -> Result<Op, String> {
    match r.stage {
        Stage::Swapping => custody.swap(
            guard_id,
            &g.settings.reserve_asset,
            policy::USDC,
            r.swap_in.as_deref().unwrap_or("0"),
            r.swap_min_out.as_deref().unwrap_or("0"),
            &r.key,
        ),
        _ => custody.withdraw(guard_id, &g.settings.hl_address, &r.usdc_units, policy::USDC, &r.key),
    }
}

/// What a sent leg means for this check's status.
fn took(r: &mut Rescue, op: Op) -> CheckStatus {
    match op {
        Op::Accepted(id) => {
            r.request_id = Some(id);
            CheckStatus::Rescued
        }
        // Sent again under the same key on the next check: harmless if this one was taken after all.
        Op::Retry | Op::Busy => CheckStatus::Pending,
        Op::Unavailable => CheckStatus::Skipped,
    }
}

/// Sends the current leg again, for a rescue already counted: in flight is `pending`, not a new `rescued`.
fn resend(custody: &Custody, guard_id: &str, g: &StoredGuard, r: &mut Rescue) -> Result<CheckStatus, String> {
    let op = send(custody, guard_id, g, r)?;
    Ok(match took(r, op) {
        CheckStatus::Rescued => CheckStatus::Pending,
        s => s,
    })
}

/// Moves an in-flight rescue along. `Some(status)` while it is still in flight; `None` once it is credited or
/// given up, so the check carries on.
fn advance(
    host: &dyn Host,
    custody: &Custody,
    guard_id: &str,
    g: &StoredGuard,
    t: &mut Track,
) -> Result<Option<CheckStatus>, String> {
    let now = host.now_ms();
    let Some(r) = t
        .rescues
        .iter_mut()
        .find(|r| matches!(r.stage, Stage::Swapping | Stage::Withdrawing))
    else {
        return Ok(None);
    };
    let Some(id) = r.request_id.clone() else {
        return resend(custody, guard_id, g, r).map(Some);
    };
    match custody.status(guard_id, &id)? {
        Request::Pending => Ok(Some(CheckStatus::Pending)),
        Request::Success { amount_out, .. } if r.stage == Stage::Swapping => {
            // The swap's realized fill is what goes to Hyperliquid.
            r.usdc_units = amount_out.or_else(|| r.swap_min_out.clone()).unwrap_or_default();
            r.stage = Stage::Withdrawing;
            r.key = format!("{}-w", r.key);
            r.request_id = None;
            resend(custody, guard_id, g, r).map(Some)
        }
        Request::Success { amount_out, dest_tx } => {
            let units = amount_out.unwrap_or_else(|| r.usdc_units.clone());
            r.credited_usd = Some(units.parse::<f64>().unwrap_or(0.0) / 1e6);
            r.credited_ms = Some(now);
            r.hl_tx = dest_tx;
            r.stage = Stage::Credited;
            Ok(None)
        }
        Request::Refunded if r.refires < MAX_REFIRES => {
            r.refires += 1;
            r.key = format!("{guard_id}-{}-r{}", r.epoch, r.refires);
            r.request_id = None;
            let op = send(custody, guard_id, g, r)?;
            Ok(Some(took(r, op)))
        }
        Request::Refunded | Request::Failed => {
            r.stage = Stage::Failed;
            let amount = r.amount_usd;
            t.budget_used_usd -= amount;
            Ok(None)
        }
    }
}

/// An isolated guard's credit lands in the account's balance; this moves it into the position with the agent key.
/// `Some(pending)` while a move is unfinished. A refusal (the credit may not be usable yet) tries again next check
/// under a fresh nonce; a lost answer sends the same nonce, which Hyperliquid won't apply twice.
fn move_margin(
    host: &dyn Host,
    custody: &Custody,
    guard_id: &str,
    g: &StoredGuard,
    t: &mut Track,
) -> Result<Option<CheckStatus>, String> {
    if g.settings.isolated.is_none() {
        return Ok(None);
    }
    let Some(r) = t.rescues.iter_mut().find(|r| {
        r.stage == Stage::Credited && !r.margin_moved && r.margin_tries < MAX_MARGIN_TRIES && r.credited_usd.is_some()
    }) else {
        return Ok(None);
    };
    r.margin_tries += 1;
    let retry = r.margin_nonce.is_some();
    let nonce = *r.margin_nonce.get_or_insert(host.now_ms());
    let asset = hl::asset_index(host, NET.hyperliquid, &r.coin)?;
    let ntli = (r.credited_usd.unwrap_or(0.0) * 1e6).floor() as u64;
    match agent::add_margin(host, custody, NET.hyperliquid, guard_id, asset, ntli, nonce)? {
        Moved::Done => r.margin_moved = true,
        Moved::Refused { nonce: true } if retry => r.margin_moved = true,
        Moved::Refused { .. } => r.margin_nonce = None,
        Moved::Unknown => {}
    }
    Ok((!r.margin_moved).then_some(CheckStatus::Pending))
}

/// Records credited rescues on the registry (the hour and a rounded amount in public, the exact figures sealed to
/// the owner), settles them, charges the save fee, and records the outcome.
fn settle_and_record(
    host: &dyn Host,
    custody: &Custody,
    guard_id: &str,
    g: &StoredGuard,
    t: &mut Track,
    positions: &[hl::HlPosition],
    fee_wallet: &str,
) -> Result<(), String> {
    let now = host.now_ms();
    let now_s = now / 1000;
    for r in t.rescues.iter_mut().filter(|r| r.stage == Stage::Credited) {
        let credited = r.credited_usd.unwrap_or(0.0);
        if r.receipt.is_none() && credited > 0.0 {
            let at = r.credited_ms.unwrap_or(now) / 1000;
            let sealed = seal_to_owner(
                host,
                guard_id,
                g,
                &json!({ "amount_usd": credited, "at_s": at, "hl_tx": r.hl_tx, "coin": r.coin }),
            )?;
            let public = json!({
                "at_hour": at_hour(at),
                "credit_usd": round_credit(credited),
                "attestation_ref": "",
                "latency_s": latency_s(at.saturating_sub(r.at_ms / 1000) as f64),
            });
            registry::call(
                host,
                "record_rescue",
                &json!({ "guard_id": guard_id, "public": public, "sealed": sealed }),
                30 * TGAS,
                0,
            )?;
            r.receipt = Some(t.receipts);
            t.receipts += 1;
        }
        let Some(index) = r.receipt else { continue };
        if r.outcome_recorded {
            continue;
        }
        if r.outcome == Outcome::Pending {
            let age = now.saturating_sub(r.at_ms) as f64 / 1000.0;
            r.outcome = match positions.iter().find(|p| p.position.coin == r.coin) {
                Some(p) => settle(r.szi, r.liq_before, mark_of(&p.position), false, age),
                // Closed or liquidated: the account's fills tell which; until then a crossing missed counts as
                // early, in the owner's favour.
                None if age >= 86_400.0 => Outcome::Early,
                None => Outcome::Pending,
            };
        }
        if r.outcome == Outcome::Pending {
            continue;
        }
        if r.outcome == Outcome::Saved && !r.fee_sent && fees_on(fee_wallet) {
            let units = ((save_fee(credited) * 1e6).round() as u128).to_string();
            match custody.transfer(
                guard_id,
                fee_wallet,
                &units,
                policy::USDC,
                &format!("{guard_id}-fee-{index}"),
            )? {
                Op::Accepted(_) => r.fee_sent = true,
                _ => continue, // tried again on the next check, under the same key
            }
        }
        let outcome = match r.outcome {
            Outcome::Saved => "Saved",
            Outcome::Early => "Early",
            _ => "Failed",
        };
        let saved_at_hour = (r.outcome == Outcome::Saved).then(|| at_hour(now_s));
        registry::call(
            host,
            "record_outcome",
            &json!({ "guard_id": guard_id, "index": index, "outcome": outcome, "saved_at_hour": saved_at_hour }),
            30 * TGAS,
            0,
        )?;
        r.outcome_recorded = true;
    }
    Ok(())
}

/// What a build decides for every guard: where fees go, and whether the hourly canary runs.
pub struct Opts<'a> {
    pub fee_wallet: &'a str,
    pub canary: bool,
}

pub fn check(host: &dyn Host, guard_id: &str) -> Result<CheckStatus, String> {
    check_with(
        host,
        guard_id,
        &Opts {
            fee_wallet: NET.fee_wallet,
            canary: canary_on(),
        },
    )
}

/// `check` with the build's choices given (tests set them; the enclave uses the ones compiled in).
pub fn check_with(host: &dyn Host, guard_id: &str, o: &Opts) -> Result<CheckStatus, String> {
    let fee_wallet = o.fee_wallet;
    if !is_guard_id(guard_id) {
        return Err("invalid guard_id".into());
    }
    let mut g: StoredGuard = vault::get(host, &format!("s/{guard_id}"))?.ok_or("no such guard")?;
    // The owner is closing it: no more rescues.
    if crate::close::is_closing(host, guard_id)? {
        return Ok(CheckStatus::Skipped);
    }
    if g.registered.is_none() {
        // A guard goes on chain once its reserve arrives; until then there is nothing to guard.
        let balances = Custody::new(host, NET.outlayer_api)?
            .balances(guard_id)?
            .unwrap_or_default();
        if !actions::funded(&balances) {
            return Ok(CheckStatus::Pending);
        }
        g = actions::activate(host, guard_id, g)?;
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
                receipts: 0,
                fee_month: None,
                canary_ms: 0,
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
    let custody = Custody::new(host, NET.outlayer_api)?;
    let now_s = now as f64 / 1000.0;

    // One rescue at a time: while one is in flight, this check only moves it along.
    if let Some(status) = advance(host, &custody, guard_id, &g, &mut t)? {
        vault::put(host, &key, &t)?;
        return Ok(status);
    }
    vault::put(host, &key, &t)?;
    let moving = move_margin(host, &custody, guard_id, &g, &mut t);
    vault::put(host, &key, &t)?;
    if let Some(status) = moving? {
        return Ok(status);
    }
    settle_and_record(host, &custody, guard_id, &g, &mut t, &positions, fee_wallet)?;
    vault::put(host, &key, &t)?;

    // The $1 guard fee, once each month, and only when the reserve can spare it: a fee never leaves it unable to pay
    // the smallest rescue. Until it can (a top-up), the month waits.
    let month = month_of(now);
    if fees_on(fee_wallet)
        && t.fee_month.as_deref() != Some(&month)
        && custody.balances(guard_id)?.is_some_and(|b| spares_fee(&b))
    {
        let units = MONTHLY_FEE_UNITS.to_string();
        if let Op::Accepted(_) = custody.transfer(
            guard_id,
            fee_wallet,
            &units,
            policy::USDC,
            &format!("{guard_id}-month-{month}"),
        )? {
            t.fee_month = Some(month);
            vault::put(host, &key, &t)?;
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

    // One rescue per epoch: wait out the cooldown after the credit, then draw a new line.
    if let Some(last) = t.rescues.last().filter(|r| r.epoch == t.epoch) {
        let since = last.credited_ms.unwrap_or(last.at_ms);
        if last.stage == Stage::Credited && now < since + s.cooldown_s * 1000 {
            vault::put(host, &key, &t)?;
            return Ok(CheckStatus::Guarding);
        }
        let (line, target) = arm(host, guard_id, &g, t.epoch + 1)?;
        (t.epoch, t.line, t.target) = (t.epoch + 1, line, target);
        vault::put(host, &key, &t)?;
    }

    if !should_fire(distance, t.line, s.speed_aware, v, HORIZON_S) {
        // Hourly, preview the smallest rescue ($2): a guard whose route is down says so ("paused") instead of
        // claiming to guard.
        if o.canary && now.saturating_sub(t.canary_ms) >= 3_600_000 {
            if !custody.withdraw_works(guard_id, &s.hl_address, "2000000", policy::USDC)? {
                vault::put(host, &key, &t)?;
                return Ok(CheckStatus::Skipped);
            }
            t.canary_ms = now;
        }
        vault::put(host, &key, &t)?;
        return Ok(CheckStatus::Guarding);
    }
    let budget_left = (s.budget_usd + g.added_usd - t.budget_used_usd).max(0.0);
    let Some(balances) = custody.balances(guard_id)? else {
        vault::put(host, &key, &t)?;
        return Ok(CheckStatus::Skipped);
    };
    let tok = if s.reserve_asset == policy::USDC {
        None
    } else {
        Some(oneclick::token(host, NET.oneclick, &s.reserve_asset)?)
    };
    let size = rescue_size(&SizeInput {
        // Fast falls get a bigger top-up: past the target by the fall expected while the credit lands.
        drawn_target: speed_target(t.target, s.speed_aware, v, HORIZON_S),
        distance,
        mark: mark_of(&p.position),
        szi: p.position.szi,
        maint_frac: p.maint_frac(),
        max_rescue_usd: s.max_rescue_usd,
        budget_left_usd: budget_left,
        reserve_usd: payable_usd(&balances, &s.reserve_asset, tok.as_ref()),
    });
    let Some(amount) = size else {
        vault::put(host, &key, &t)?;
        return Ok(CheckStatus::Guarding);
    };
    // A credit can't reach an isolated position without the owner's approval, so without it the reserve stays put.
    if iso.is_some() {
        let agent = custody.evm_address(guard_id)?;
        if !hl::agent_approved(host, NET.hyperliquid, &s.hl_address, &agent, now)? {
            vault::put(host, &key, &t)?;
            return Ok(CheckStatus::Skipped);
        }
    }

    let usdc_units = ((amount * 1e6).floor() as u128).to_string();
    let (stage, swap_in, swap_min_out) = match &tok {
        None => (Stage::Withdrawing, None, None),
        // Sell a little more than needed (3 %) and refuse a fill under 98 % of the rescue.
        Some(tok) => {
            let amount_in = ((amount * 1.03 * tok.per_usd()).ceil() as u128).to_string();
            let min_out = ((amount * 0.98 * 1e6).floor() as u128).to_string();
            (Stage::Swapping, Some(amount_in), Some(min_out))
        }
    };
    let mut r = Rescue {
        epoch: t.epoch,
        coin: p.position.coin.clone(),
        szi: p.position.szi,
        liq_before: p.position.liquidation_px.unwrap_or_default(),
        at_ms: now,
        amount_usd: amount,
        stage,
        key: format!("{guard_id}-{}", t.epoch),
        request_id: None,
        refires: 0,
        swap_in,
        swap_min_out,
        usdc_units,
        credited_usd: None,
        credited_ms: None,
        hl_tx: None,
        receipt: None,
        outcome: Outcome::Pending,
        fee_sent: false,
        outcome_recorded: false,
        margin_moved: false,
        margin_nonce: None,
        margin_tries: 0,
    };
    let op = send(&custody, guard_id, &g, &r)?;
    let status = took(&mut r, op);
    if status != CheckStatus::Skipped {
        t.budget_used_usd += amount;
        t.rescues.push(r);
    }
    vault::put(host, &key, &t)?;
    Ok(status)
}
