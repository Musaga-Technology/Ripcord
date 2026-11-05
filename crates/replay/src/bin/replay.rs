//! Runs the replay harness over cached Binance 1-minute klines (`scripts/replay/fetch.py`).
//!
//!     cargo run -p ripcord-replay --release -- 2025-10 2026-06            # monthly files, the tuning period
//!     cargo run -p ripcord-replay --release -- 2026-10-01 2026-11-09      # daily files too, for the holdout
//!
//! A $10K long and a $10K short every 12 h, each held 7 days, per asset × leverage × reserve × mode.
use ripcord_replay::{parse_csv, replay, starts, Bar, Mode, Preset, Sim, Summary};
use std::path::PathBuf;

/// (symbol, max leverage, leverages replayed)
const ASSETS: [(&str, f64, [f64; 2]); 4] = [
    ("BTCUSDT", 40.0, [10.0, 20.0]),
    ("ETHUSDT", 25.0, [10.0, 20.0]),
    ("SOLUSDT", 20.0, [5.0, 10.0]),
    ("HYPEUSDT", 10.0, [3.0, 5.0]),
];
pub const MODES: [Mode; 8] = [
    Mode::Unguarded,
    Mode::Upfront,
    Mode::Guarded {
        preset: Preset::Safer,
        speed_aware: false,
    },
    Mode::Guarded {
        preset: Preset::Safer,
        speed_aware: true,
    },
    Mode::Guarded {
        preset: Preset::Balanced,
        speed_aware: false,
    },
    Mode::Guarded {
        preset: Preset::Balanced,
        speed_aware: true,
    },
    Mode::Guarded {
        preset: Preset::Lean,
        speed_aware: false,
    },
    Mode::Guarded {
        preset: Preset::Lean,
        speed_aware: true,
    },
];

fn name(m: Mode) -> String {
    match m {
        Mode::Unguarded => "unguarded".into(),
        Mode::Upfront => "upfront".into(),
        Mode::Guarded { preset, speed_aware } => {
            format!("{preset:?}{}", if speed_aware { " +speed" } else { "" }).to_lowercase()
        }
    }
}

/// Days since 1970 for a civil date (Howard Hinnant's algorithm), so dates need no dependency.
fn days(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

/// "YYYY-MM" or "YYYY-MM-DD" → (ms at the start of it, ms at its end).
fn span(s: &str) -> (i64, i64) {
    let p: Vec<i64> = s.split('-').map(|x| x.parse().expect("date")).collect();
    let day = 86_400_000;
    match p[..] {
        [y, m] => {
            let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
            (days(y, m, 1) * day, days(ny, nm, 1) * day - 1)
        }
        [y, m, d] => (days(y, m, d) * day, (days(y, m, d) + 1) * day - 1),
        _ => panic!("dates are YYYY-MM or YYYY-MM-DD"),
    }
}

fn load(dir: &PathBuf, symbol: &str, from: i64, to: i64) -> Vec<Bar> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("cache dir: run scripts/replay/fetch.py first")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(&format!("{symbol}-1m-")))
        })
        .collect();
    files.sort();
    let mut bars: Vec<Bar> = files
        .iter()
        .flat_map(|f| parse_csv(&std::fs::read_to_string(f).unwrap()))
        .collect();
    bars.sort_by_key(|b| b.t);
    bars.dedup_by_key(|b| b.t);
    // Keep 8 days past the end so the last positions can be held and settled.
    bars.retain(|b| b.t >= from && b.t <= to + 8 * 86_400_000);
    bars
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (from, to) = match &args[..] {
        [a, b, ..] => (span(a).0, span(b).1),
        _ => panic!("usage: replay <from YYYY-MM[-DD]> <to YYYY-MM[-DD]>"),
    };
    let dir = std::env::var("RIPCORD_REPLAY_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap()).join(".cache/ripcord-replay"));
    println!("asset    lev  reserve  mode              positions  liquidated  rescues  saved  early  failed");
    for (symbol, max_lev, levs) in ASSETS {
        let bars = load(&dir, symbol, from, to);
        if bars.is_empty() {
            println!("{symbol}: no data");
            continue;
        }
        let st = starts(&bars, from, to, 720);
        for lev in levs {
            for reserve_x in [0.5, 1.0, 2.0] {
                for mode in MODES {
                    let sim = Sim {
                        leverage: lev,
                        mm: 1.0 / (2.0 * max_lev),
                        reserve_x,
                        delay_bars: 1,
                        hold_bars: 10_080,
                        mode,
                    };
                    let (s, _): (Summary, _) = replay(&bars, &st, &sim, 1);
                    println!(
                        "{:<8} {:>3}×  {:>5.1}×   {:<16} {:>9}  {:>6.2} %   {:>7}  {:>5}  {:>5}  {:>6}",
                        symbol.trim_end_matches("USDT"),
                        lev,
                        reserve_x,
                        name(mode),
                        s.positions,
                        s.liquidated_pct(),
                        s.rescues,
                        s.saved,
                        s.early,
                        s.failed
                    );
                }
            }
        }
    }
}
