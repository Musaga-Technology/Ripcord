//! The harness's own model: liquidation prices, data parsing, scheduling and reproducibility.
use ripcord_replay::{liq_price, parse_csv, replay, run, starts, Bar, Mode, Preset, Sim};

#[test]
fn liquidation_prices_follow_the_maintenance_rule() {
    // 10× long, BTC's 1.25 % maintenance: entry × (1 − 1/10) / (1 − 0.0125).
    let (entry, size) = (80_000.0, 0.125);
    let long = liq_price(1.0, entry, size, 1_000.0, 0.0125);
    assert!((long - entry * 0.9 / 0.9875).abs() < 1e-6);
    let short = liq_price(-1.0, entry, size, 1_000.0, 0.0125);
    assert!((short - entry * 1.1 / 1.0125).abs() < 1e-6);
    assert!(
        liq_price(1.0, entry, size, 2_000.0, 0.0125) < long,
        "more margin, further away"
    );
}

#[test]
fn parses_the_cached_csv_and_skips_junk() {
    let b = parse_csv("1760097600000,121.5,120.0,121.0\nopen_time,high,low,close\n1760097660000,122,121,121.5\n");
    assert_eq!(
        b,
        [
            Bar {
                t: 1_760_097_600_000,
                high: 121.5,
                low: 120.0,
                close: 121.0
            },
            Bar {
                t: 1_760_097_660_000,
                high: 122.0,
                low: 121.0,
                close: 121.5
            }
        ]
    );
}

fn ramp(n: usize, from: f64, to: f64) -> Vec<Bar> {
    (0..n)
        .map(|i| {
            let p = from + (to - from) * i as f64 / (n - 1) as f64;
            Bar {
                t: i as i64 * 60_000,
                high: p * 1.001,
                low: p * 0.999,
                close: p,
            }
        })
        .collect()
}

#[test]
fn a_slow_fall_is_rescued_and_saved_where_unguarded_is_liquidated() {
    let bars = ramp(600, 100.0, 85.0); // −15 % over 10 hours; 10× long liquidates near −8.9 %
    let sim = |mode| Sim {
        leverage: 10.0,
        mm: 0.0125,
        reserve_x: 1.0,
        delay_bars: 1,
        hold_bars: 599,
        mode,
    };
    assert!(run(&bars, 0, 1.0, &sim(Mode::Unguarded), 1).liquidated);
    let g = run(
        &bars,
        0,
        1.0,
        &sim(Mode::Guarded {
            preset: Preset::Balanced,
            speed_aware: true,
        }),
        1,
    );
    assert!(!g.liquidated && g.rescues >= 1 && g.saved >= 1, "{g:?}");
}

#[test]
fn schedules_and_draws_are_reproducible() {
    let bars = ramp(3_000, 100.0, 90.0);
    let st = starts(&bars, 0, 1_000 * 60_000, 720);
    assert_eq!(st, [0, 720]);
    let sim = Sim {
        leverage: 10.0,
        mm: 0.0125,
        reserve_x: 1.0,
        delay_bars: 1,
        hold_bars: 2_000,
        mode: Mode::Guarded {
            preset: Preset::Lean,
            speed_aware: false,
        },
    };
    assert_eq!(replay(&bars, &st, &sim, 9), replay(&bars, &st, &sim, 9));
}
