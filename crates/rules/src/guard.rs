//! The guard's decisions as pure functions (docs/SPEC.md §3 "One check"). Mirrors `packages/shared/src/guard.ts`.
//! Distances are in %.
use crate::types::{LeverageType, Outcome, Position, Preset};

pub fn distance_pct(liquidation_px: Option<f64>, mark: f64) -> Option<f64> {
    liquidation_px.map(|lp| (lp - mark).abs() / mark * 100.0)
}

/// Mark price from `clearinghouseState` alone (weight 2): positionValue / |szi|.
pub fn mark_of(p: &Position) -> f64 {
    p.position_value / p.szi.abs()
}

/// The minimum over cross positions, or the isolated coin's distance; None if nothing is at risk.
pub fn guard_distance(positions: &[Position], isolated_coin: Option<&str>) -> Option<f64> {
    positions
        .iter()
        .filter(|p| match isolated_coin {
            Some(c) => p.coin == c,
            None => p.leverage_type == LeverageType::Cross,
        })
        .filter_map(|p| distance_pct(p.liquidation_px, mark_of(p)))
        .reduce(f64::min)
}

/// How fast the distance is falling, in percentage points per second, over the last `window_s` seconds (≥ 0).
pub fn fall_rate(history: &[(f64, f64)], now_t: f64, now_d: f64, window_s: f64) -> f64 {
    let first = history
        .iter()
        .filter(|(t, _)| now_t - t <= window_s)
        .min_by(|a, b| a.partial_cmp(b).expect("finite"));
    match first {
        None => 0.0,
        Some(&(t0, d0)) => {
            let span = now_t - t0;
            if span < 1.0 {
                0.0
            } else {
                ((d0 - now_d) / span).max(0.0)
            }
        }
    }
}

/// Fire below the drawn line, or (speed-aware) when the fall rate would cross it within the rescue time.
pub fn should_fire(distance: f64, drawn_line: f64, speed_aware: bool, v: f64, horizon_s: f64) -> bool {
    distance < drawn_line || (speed_aware && distance - v * horizon_s < drawn_line)
}

/// A speed-aware rescue tops up past the drawn target by this many times the fall expected while the credit lands
/// (tuned on Oct 2025 – Jun 2026 replays: fewer liquidations and fewer, larger rescues than topping up to the target).
pub const SPEED_BOOST: f64 = 3.0;

pub fn speed_target(drawn_target: f64, speed_aware: bool, v: f64, horizon_s: f64) -> f64 {
    drawn_target + if speed_aware { SPEED_BOOST * v * horizon_s } else { 0.0 }
}

pub struct SizeInput {
    pub drawn_target: f64,
    pub distance: f64,
    pub mark: f64,
    pub szi: f64,
    pub maint_frac: f64,
    pub max_rescue_usd: f64,
    pub budget_left_usd: f64,
    pub reserve_usd: f64,
}

/// The smallest rescue the private route to Hyperliquid carries ($2 lands $1.68 in about 20 s; $1 is refused).
pub const MIN_RESCUE_USD: f64 = 2.0;

/// USDC needed to lift the distance to the drawn target, at least the route's minimum (a small position gets the
/// minimum rather than no rescue), within the cap, the budget left and the reserve; None when they allow less than
/// the minimum.
pub fn rescue_size(i: &SizeInput) -> Option<f64> {
    let side = if i.szi > 0.0 { 1.0 } else { -1.0 };
    let need = (i.drawn_target - i.distance) / 100.0 * i.mark * i.szi.abs() * (1.0 - i.maint_frac * side);
    let room = i.max_rescue_usd.min(i.budget_left_usd).min(i.reserve_usd);
    if room < MIN_RESCUE_USD {
        None
    } else {
        Some(need.max(MIN_RESCUE_USD).min(room))
    }
}

/// 3 % of a saved rescue, 0.5 % on any part above $50,000.
pub fn save_fee(t: f64) -> f64 {
    0.03 * t.min(50_000.0) + 0.005 * (t - 50_000.0).max(0.0)
}

fn round_half_up(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Public receipts carry the credit to 2 significant figures: 1,486.18 → 1,500; 640 → 640.
pub fn round_credit(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let p = x.log10().floor() as i32 - 1;
    if p >= 0 {
        let s = 10f64.powi(p);
        round_half_up(x / s) * s
    } else {
        let s = 10f64.powi(-p);
        round_half_up(x * s) / s
    }
}

pub fn at_hour(at_s: u64) -> u64 {
    at_s / 3600 * 3600
}

pub fn latency_s(seconds: f64) -> u64 {
    round_half_up(seconds) as u64
}

/// A point inside a sealed range from enclave randomness u ∈ [0, 1).
pub fn draw(lo: f64, hi: f64, u: f64) -> f64 {
    lo + u * (hi - lo)
}

/// Settle a rescue: saved if the mark later crossed the liquidation price from before it.
pub fn settle(szi: f64, liq_before: f64, mark: f64, liquidated: bool, age_s: f64) -> Outcome {
    if liquidated {
        Outcome::Failed
    } else if (szi > 0.0 && mark <= liq_before) || (szi < 0.0 && mark >= liq_before) {
        Outcome::Saved
    } else if age_s >= 86_400.0 {
        Outcome::Early
    } else {
        Outcome::Pending
    }
}

/// Line and target as fractions of the position's distance from liquidation at setup (docs/ARCHITECTURE.md §4.2).
pub fn preset_fractions(preset: Preset) -> (f64, f64) {
    match preset {
        Preset::Safer => (0.75, 1.10),
        Preset::Balanced => (0.60, 1.00),
        Preset::Lean => (0.45, 0.90),
    }
}

/// The sealed ranges' half-width around a preset's line and target, as a fraction of each.
pub const RANGE_WIDTH: f64 = 0.15;

/// A preset's sealed ranges for a position `d0` % from liquidation, or `None` if they wouldn't pass the checker.
pub fn preset_ranges(preset: Preset, d0: f64) -> Option<([f64; 2], [f64; 2])> {
    let round2 = |x: f64| (x * 100.0 + 0.5).floor() / 100.0;
    let (lf, tf) = preset_fractions(preset);
    let (line, target) = (lf * d0, tf * d0);
    let lo = round2(line * (1.0 - RANGE_WIDTH));
    let hi = round2(line * (1.0 + RANGE_WIDTH)).min(50.0);
    let tlo = round2(target * (1.0 - RANGE_WIDTH));
    let thi = round2(target * (1.0 + RANGE_WIDTH)).min(80.0);
    if lo < 0.5 || lo > hi || tlo <= hi || tlo > thi {
        return None;
    }
    Some(([lo, hi], [tlo, thi]))
}
