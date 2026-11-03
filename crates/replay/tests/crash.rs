//! The Oct 10 2025 crash through the guard's own rules (Binance USDⓈ-M 1-minute klines, cascade 20:50–21:30 UTC):
//! $10K longs opened every 10 minutes from 12:00 to 20:40, held 24 h. Fixture from `scripts/replay/fixture.py`.
use ripcord_replay::{parse_csv, run, Bar, Mode, PositionResult, Preset, Sim};

fn bars(sym: &str) -> Vec<Bar> {
    let text = match sym {
        "BTC" => include_str!("fixtures/BTCUSDT-2025-10-10.csv"),
        "ETH" => include_str!("fixtures/ETHUSDT-2025-10-10.csv"),
        _ => include_str!("fixtures/SOLUSDT-2025-10-10.csv"),
    };
    parse_csv(text)
}

/// (asset, max leverage, leverage)
const CASES: [(&str, f64, f64); 6] = [
    ("BTC", 40.0, 10.0),
    ("BTC", 40.0, 20.0),
    ("ETH", 25.0, 10.0),
    ("ETH", 25.0, 20.0),
    ("SOL", 20.0, 5.0),
    ("SOL", 20.0, 10.0),
];

fn longs(sym: &str, max_lev: f64, lev: f64, reserve_x: f64, mode: Mode, delay_bars: usize) -> Vec<PositionResult> {
    let b = bars(sym);
    // 12:00 → 20:40 every 10 minutes: bars 0, 10, … 520
    (0..=520)
        .step_by(10)
        .map(|i| {
            let sim = Sim {
                leverage: lev,
                mm: 1.0 / (2.0 * max_lev),
                reserve_x,
                delay_bars,
                hold_bars: 1_440,
                mode,
            };
            run(&b, i, 1.0, &sim, 7 + i as u64)
        })
        .collect()
}

fn liquidated(r: &[PositionResult]) -> usize {
    r.iter().filter(|r| r.liquidated).count()
}

const BALANCED_SPEED: Mode = Mode::Guarded {
    preset: Preset::Balanced,
    speed_aware: true,
};

/// The positions a cascade can be survived at: upfront margin saves them (at 20× BTC and ETH, and 10× SOL, even 2×
/// margin posted upfront was liquidated on Oct 10, so no guard could help).
const SURVIVABLE: [(&str, f64, f64); 3] = [("BTC", 40.0, 10.0), ("ETH", 25.0, 10.0), ("SOL", 20.0, 5.0)];

#[test]
fn the_crash_liquidates_every_unguarded_long() {
    for (sym, max_lev, lev) in SURVIVABLE {
        assert_eq!(
            liquidated(&longs(sym, max_lev, lev, 1.0, Mode::Unguarded, 1)),
            53,
            "{sym} {lev}×"
        );
    }
}

#[test]
fn balanced_and_speed_aware_matches_posting_the_reserve_upfront() {
    // The harness's target (docs/ARCHITECTURE.md): no liquidation where the same reserve posted upfront survives.
    // With a 60 s credit it holds for every case but one ETH position at 2×.
    for (sym, max_lev, lev) in SURVIVABLE {
        for reserve_x in [1.0, 2.0] {
            let up = longs(sym, max_lev, lev, reserve_x, Mode::Upfront, 1);
            let g = longs(sym, max_lev, lev, reserve_x, BALANCED_SPEED, 1);
            let lost = up.iter().zip(&g).filter(|(u, g)| !u.liquidated && g.liquidated).count();
            assert!(
                lost <= 1,
                "{sym} {lev}× {reserve_x}×: {lost} positions upfront margin saves are liquidated"
            );
        }
    }
}

#[test]
fn a_two_minute_credit_still_saves_most() {
    for (sym, max_lev, lev) in SURVIVABLE {
        for reserve_x in [1.0, 2.0] {
            let up = liquidated(&longs(sym, max_lev, lev, reserve_x, Mode::Upfront, 2));
            let g = liquidated(&longs(sym, max_lev, lev, reserve_x, BALANCED_SPEED, 2));
            assert!(g <= up + 8, "{sym} {lev}× {reserve_x}×: {g} vs {up} upfront");
        }
    }
}

#[test]
fn the_speed_aware_trigger_is_never_worse() {
    for (sym, max_lev, lev) in CASES {
        for reserve_x in [1.0, 2.0] {
            for preset in [Preset::Safer, Preset::Balanced, Preset::Lean] {
                for delay in [1, 2] {
                    let plain = liquidated(&longs(
                        sym,
                        max_lev,
                        lev,
                        reserve_x,
                        Mode::Guarded {
                            preset,
                            speed_aware: false,
                        },
                        delay,
                    ));
                    let fast = liquidated(&longs(
                        sym,
                        max_lev,
                        lev,
                        reserve_x,
                        Mode::Guarded {
                            preset,
                            speed_aware: true,
                        },
                        delay,
                    ));
                    assert!(
                        fast <= plain,
                        "{sym} {lev}× {reserve_x}× {preset:?} delay {delay}: {fast} > {plain}"
                    );
                }
            }
        }
    }
}

#[test]
fn lean_fires_too_late_for_a_cascade() {
    // Reported, not hidden: Lean's line sits at 0.45 × D0, so a cascade's one-minute drops can cross what is left
    // before a top-up lands, even with the speed-aware trigger.
    let (sym, max_lev, lev) = SURVIVABLE[2];
    let lean = liquidated(&longs(
        sym,
        max_lev,
        lev,
        2.0,
        Mode::Guarded {
            preset: Preset::Lean,
            speed_aware: true,
        },
        1,
    ));
    let balanced = liquidated(&longs(sym, max_lev, lev, 2.0, BALANCED_SPEED, 1));
    assert!(lean > balanced, "{lean} vs {balanced}");
}

/// The full table: `cargo test -p ripcord-replay --release --test crash -- --ignored --nocapture`
#[test]
#[ignore]
fn table() {
    println!("asset lev reserve  mode                credit  unguarded upfront guarded");
    for (sym, max_lev, lev) in CASES {
        for reserve_x in [1.0, 2.0] {
            let un = liquidated(&longs(sym, max_lev, lev, reserve_x, Mode::Unguarded, 1));
            for delay in [1, 2] {
                let up = liquidated(&longs(sym, max_lev, lev, reserve_x, Mode::Upfront, delay));
                for preset in [Preset::Safer, Preset::Balanced, Preset::Lean] {
                    for sa in [false, true] {
                        let g = liquidated(&longs(
                            sym,
                            max_lev,
                            lev,
                            reserve_x,
                            Mode::Guarded {
                                preset,
                                speed_aware: sa,
                            },
                            delay,
                        ));
                        let mode = format!("{preset:?}{}", if sa { " +speed" } else { "" });
                        println!(
                            "{sym:<5} {lev:>2}× {reserve_x:>4}×   {mode:<18} {:>4} s  {un:>6}/53 {up:>4}/53 {g:>4}/53",
                            delay * 60
                        );
                    }
                }
            }
        }
    }
}
