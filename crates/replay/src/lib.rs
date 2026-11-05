//! The crash replay harness (docs/ARCHITECTURE.md, "Crash replay harness"): real 1-minute price paths through the
//! guard's own decisions (`ripcord_rules::guard`, the code the enclave runs), compared with leaving the position
//! alone and with posting the same reserve upfront as margin.
//!
//! The model, kept deliberately harsh: an isolated $10,000 position; Hyperliquid's maintenance rule (half the
//! initial margin at max leverage); liquidation tested on each bar's low (long) or high (short), not the smoother
//! mark; decisions on bar closes; a rescue's credit lands `delay_bars` bars after it fires, and the bars in between
//! are tested against the old liquidation price. A rescue is saved if, within 24 h, the price crosses the
//! liquidation price from before it; early if it doesn't; failed if the position is liquidated anyway.
use ripcord_rules::guard::{
    draw, fall_rate, preset_fractions, rescue_size, settle, should_fire, speed_target, SizeInput,
};
use ripcord_rules::types::{self, Outcome};

pub const NOTIONAL: f64 = 10_000.0;
/// The sealed ranges' half-width around a preset's line and target, as a fraction of each.
pub const RANGE_WIDTH: f64 = 0.15;
/// The speed-aware trigger's look-ahead and fall-rate window, as in the checker.
pub const HORIZON_S: f64 = 60.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bar {
    /// Open time, ms.
    pub t: i64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
}

/// `open_time_ms,high,low,close` per line, as `scripts/replay/fetch.py` writes them.
pub fn parse_csv(text: &str) -> Vec<Bar> {
    text.lines()
        .filter_map(|l| {
            let mut f = l.split(',');
            Some(Bar {
                t: f.next()?.trim().parse().ok()?,
                high: f.next()?.trim().parse().ok()?,
                low: f.next()?.trim().parse().ok()?,
                close: f.next()?.trim().parse().ok()?,
            })
        })
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Preset {
    Safer,
    Balanced,
    Lean,
}

impl Preset {
    /// Line and target as fractions of the starting distance to liquidation D0 (docs/ARCHITECTURE.md §4.2).
    pub fn fractions(self) -> (f64, f64) {
        preset_fractions(match self {
            Preset::Safer => types::Preset::Safer,
            Preset::Balanced => types::Preset::Balanced,
            Preset::Lean => types::Preset::Lean,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Unguarded,
    /// The same reserve posted as margin at the start: visible to everyone.
    Upfront,
    Guarded {
        preset: Preset,
        speed_aware: bool,
    },
}

#[derive(Clone, Copy, Debug)]
pub struct Sim {
    pub leverage: f64,
    /// Maintenance margin fraction: 1 / (2 × max leverage).
    pub mm: f64,
    /// The reserve as a multiple of the initial margin.
    pub reserve_x: f64,
    pub delay_bars: usize,
    pub hold_bars: usize,
    pub mode: Mode,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PositionResult {
    pub liquidated: bool,
    pub rescues: u32,
    pub saved: u32,
    pub early: u32,
    pub failed: u32,
}

/// The isolated liquidation price: equity = maintenance, for `margin` behind `size` coins bought at `entry`.
pub fn liq_price(side: f64, entry: f64, size: f64, margin: f64, mm: f64) -> f64 {
    if side > 0.0 {
        (entry * size - margin) / (size * (1.0 - mm))
    } else {
        (entry * size + margin) / (size * (1.0 + mm))
    }
}

fn crossed(side: f64, b: &Bar, price: f64) -> bool {
    if side > 0.0 {
        b.low <= price
    } else {
        b.high >= price
    }
}

/// SplitMix64: the enclave's randomness, made reproducible.
struct Rng(u64);
impl Rng {
    fn uniform(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }
}

const SETTLE_BARS: usize = 1_440;

/// One position opened at `bars[start].close` on `side` (+1 long, −1 short), held `hold_bars` or until liquidated.
pub fn run(bars: &[Bar], start: usize, side: f64, sim: &Sim, seed: u64) -> PositionResult {
    let entry = bars[start].close;
    let size = NOTIONAL / entry;
    let reserve = sim.reserve_x * NOTIONAL / sim.leverage;
    let mut margin = NOTIONAL / sim.leverage + if sim.mode == Mode::Upfront { reserve } else { 0.0 };
    let mut liq = liq_price(side, entry, size, margin, sim.mm);
    let d0 = (liq - entry).abs() / entry * 100.0;

    let mut rng = Rng(seed);
    let arm = |preset: Preset, rng: &mut Rng| {
        let (lf, tf) = preset.fractions();
        let (l, t) = (lf * d0, tf * d0);
        (
            draw(l * (1.0 - RANGE_WIDTH), l * (1.0 + RANGE_WIDTH), rng.uniform()),
            draw(t * (1.0 - RANGE_WIDTH), t * (1.0 + RANGE_WIDTH), rng.uniform()),
        )
    };
    let (mut line, mut target) = match sim.mode {
        Mode::Guarded { preset, .. } => arm(preset, &mut rng),
        _ => (0.0, 0.0),
    };

    let mut left = reserve;
    let mut in_flight: Option<(usize, f64)> = None;
    let mut ready_at = start;
    let mut history: Vec<(f64, f64)> = vec![];
    let mut fired: Vec<(usize, f64)> = vec![];
    let mut liq_bar = None;
    let end = (start + sim.hold_bars).min(bars.len() - 1);

    for (i, b) in bars.iter().enumerate().take(end + 1).skip(start + 1) {
        if crossed(side, b, liq) {
            liq_bar = Some(i);
            break;
        }
        if let Some((land, amount)) = in_flight {
            if i >= land {
                margin += amount;
                liq = liq_price(side, entry, size, margin, sim.mm);
                in_flight = None;
                ready_at = i + 1; // the 60 s cooldown, then a new draw
                if let Mode::Guarded { preset, .. } = sim.mode {
                    (line, target) = arm(preset, &mut rng);
                }
            }
        }
        let Mode::Guarded { speed_aware, .. } = sim.mode else {
            continue;
        };
        let d = (liq - b.close).abs() / b.close * 100.0;
        let t = b.t as f64 / 1000.0;
        history.retain(|(ts, _)| t - ts <= HORIZON_S);
        let v = fall_rate(&history, t, d, HORIZON_S);
        history.push((t, d));
        if in_flight.is_some() || i < ready_at || !should_fire(d, line, speed_aware, v, HORIZON_S) {
            continue;
        }
        let amount = rescue_size(&SizeInput {
            drawn_target: speed_target(target, speed_aware, v, HORIZON_S),
            distance: d,
            mark: b.close,
            szi: side * size,
            maint_frac: sim.mm,
            max_rescue_usd: left,
            budget_left_usd: left,
            reserve_usd: left,
        });
        if let Some(a) = amount {
            left -= a;
            in_flight = Some((i + sim.delay_bars, a));
            fired.push((i, liq));
        }
    }

    let mut r = PositionResult {
        liquidated: liq_bar.is_some(),
        rescues: fired.len() as u32,
        ..Default::default()
    };
    for (f, liq_before) in fired {
        let last = (f + SETTLE_BARS).min(bars.len() - 1);
        let mut outcome = Outcome::Early;
        for (j, b) in bars.iter().enumerate().take(last + 1).skip(f + 1) {
            let extreme = if side > 0.0 { b.low } else { b.high };
            let age = (j - f) as f64 * 60.0;
            match settle(side * size, liq_before, extreme, liq_bar == Some(j), age) {
                Outcome::Pending => continue,
                o => {
                    outcome = o;
                    break;
                }
            }
        }
        match outcome {
            Outcome::Saved => r.saved += 1,
            Outcome::Failed => r.failed += 1,
            _ => r.early += 1,
        }
    }
    r
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Summary {
    pub positions: u32,
    pub liquidated: u32,
    pub rescues: u32,
    pub saved: u32,
    pub early: u32,
    pub failed: u32,
}

impl Summary {
    pub fn add(&mut self, r: &PositionResult) {
        self.positions += 1;
        self.liquidated += r.liquidated as u32;
        self.rescues += r.rescues;
        self.saved += r.saved;
        self.early += r.early;
        self.failed += r.failed;
    }

    pub fn liquidated_pct(&self) -> f64 {
        100.0 * self.liquidated as f64 / self.positions.max(1) as f64
    }
}

/// Bar indices from `from_ms` to `to_ms` (inclusive), every `step_bars`.
pub fn starts(bars: &[Bar], from_ms: i64, to_ms: i64, step_bars: usize) -> Vec<usize> {
    let first = bars.partition_point(|b| b.t < from_ms);
    (first..bars.len())
        .step_by(step_bars.max(1))
        .take_while(|&i| bars[i].t <= to_ms)
        .collect()
}

/// Runs a long and a short from every start; `seed` makes each position's draws reproducible.
pub fn replay(bars: &[Bar], starts: &[usize], sim: &Sim, seed: u64) -> (Summary, Vec<PositionResult>) {
    let mut s = Summary::default();
    let mut all = vec![];
    for &i in starts {
        for side in [1.0, -1.0] {
            let r = run(
                bars,
                i,
                side,
                sim,
                seed ^ (i as u64).wrapping_mul(0x2545_F491_4F6C_DD1D) ^ (side > 0.0) as u64,
            );
            s.add(&r);
            all.push(r);
        }
    }
    (s, all)
}
