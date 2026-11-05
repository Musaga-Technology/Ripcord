//! Golden vectors from scripts/vectors.py, the same files packages/shared tests against: TypeScript, Rust and
//! Python must agree on every hash and guard decision.
use ripcord_rules::canonical::canonical;
use ripcord_rules::commitment::*;
use ripcord_rules::guard::*;
use ripcord_rules::types::{GuardSettings, Outcome, Position, Preset};
use serde_json::Value;

fn load(name: &str) -> Value {
    let text = match name {
        "commitment" => include_str!("../../../packages/shared/vectors/commitment.json"),
        _ => include_str!("../../../packages/shared/vectors/guard.json"),
    };
    serde_json::from_str(text).expect("vectors parse")
}

fn f(v: &Value) -> f64 {
    v.as_f64().expect("number")
}

fn s(v: &Value) -> &str {
    v.as_str().expect("string")
}

fn close(a: Option<f64>, b: Option<f64>) {
    match (a, b) {
        (Some(a), Some(b)) => assert!((a - b).abs() <= 1e-9 * b.abs().max(1.0), "{a} vs {b}"),
        (a, b) => assert_eq!(a, b),
    }
}

#[test]
fn canonical_json() {
    let v = load("commitment");
    for c in v["canonical"].as_array().unwrap() {
        assert_eq!(canonical(&c["input"]).unwrap(), s(&c["canonical"]));
    }
    for r in v["canonical_rejects"].as_array().unwrap() {
        assert_eq!(canonical(&r["input"]).unwrap_err().0, s(&r["why"]));
    }
}

#[test]
fn commitments_and_fingerprints() {
    let v = load("commitment");
    for c in v["commitments"].as_array().unwrap() {
        let settings: GuardSettings = serde_json::from_value(c["settings"].clone()).unwrap();
        assert_eq!(
            canonical(&serde_json::to_value(&settings).unwrap()).unwrap(),
            s(&c["canonical"])
        );
        assert_eq!(commitment(&settings, s(&c["salt"])).unwrap(), s(&c["commitment"]));
        assert_eq!(fingerprint(s(&c["commitment"])), s(&c["fingerprint"]));
        assert_eq!(fingerprint_short(s(&c["commitment"])), s(&c["fingerprint_short"]));
    }
}

#[test]
fn owners_accounts_and_ids() {
    let v = load("commitment");
    for o in v["owners"].as_array().unwrap() {
        assert_eq!(owner_salt(s(&o["signature"])).unwrap(), s(&o["owner_salt"]));
        assert_eq!(
            owner_commitment(s(&o["owner"]), s(&o["owner_salt"])).unwrap(),
            s(&o["owner_commitment"])
        );
    }
    for a in v["accounts"].as_array().unwrap() {
        assert_eq!(
            account_commitment(s(&a["hl_address"]), s(&a["account_salt"])).unwrap(),
            s(&a["account_commitment"])
        );
    }
    for g in v["guard_ids"].as_array().unwrap() {
        assert_eq!(
            guard_id_from_bits(g["bits"].as_u64().unwrap()).unwrap(),
            s(&g["guard_id"])
        );
    }
    for g in v["guard_id_checks"].as_array().unwrap() {
        assert_eq!(is_guard_id(s(&g["s"])), g["valid"].as_bool().unwrap(), "{}", s(&g["s"]));
    }
    assert_eq!(
        account_commitment("0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3", &"AB".repeat(32)),
        Err(HashError::Salt)
    );
}

#[test]
fn guard_decisions() {
    let v = load("guard");
    for d in v["distance"].as_array().unwrap() {
        close(
            distance_pct(d["liquidation_px"].as_f64(), f(&d["mark"])),
            d["distance_pct"].as_f64(),
        );
    }
    for g in v["guard_distance"].as_array().unwrap() {
        let positions: Vec<Position> = serde_json::from_value(g["positions"].clone()).unwrap();
        close(
            guard_distance(&positions, g["isolated_coin"].as_str()),
            g["distance_pct"].as_f64(),
        );
    }
    for r in v["fall_rate"].as_array().unwrap() {
        let h: Vec<(f64, f64)> = serde_json::from_value(r["history"].clone()).unwrap();
        close(
            Some(fall_rate(&h, f(&r["now_t"]), f(&r["now_d"]), 60.0)),
            Some(f(&r["v"])),
        );
    }
    for r in v["should_fire"].as_array().unwrap() {
        let fire = should_fire(
            f(&r["distance"]),
            f(&r["drawn_line"]),
            r["speed_aware"].as_bool().unwrap(),
            f(&r["v"]),
            60.0,
        );
        assert_eq!(fire, r["fire"].as_bool().unwrap());
    }
    for r in v["speed_target"].as_array().unwrap() {
        let t = speed_target(
            f(&r["drawn_target"]),
            r["speed_aware"].as_bool().unwrap(),
            f(&r["v"]),
            60.0,
        );
        close(Some(t), Some(f(&r["target"])));
    }
    for r in v["rescue_size"].as_array().unwrap() {
        let i = SizeInput {
            drawn_target: f(&r["drawn_target"]),
            distance: f(&r["distance"]),
            mark: f(&r["mark"]),
            szi: f(&r["szi"]),
            maint_frac: f(&r["maint_frac"]),
            max_rescue_usd: f(&r["max_rescue_usd"]),
            budget_left_usd: f(&r["budget_left_usd"]),
            reserve_usd: f(&r["reserve_usd"]),
        };
        close(rescue_size(&i), r["size_usd"].as_f64());
    }
    for r in v["save_fee"].as_array().unwrap() {
        close(Some(save_fee(f(&r["t"]))), Some(f(&r["fee"])));
    }
    for r in v["round_credit"].as_array().unwrap() {
        assert_eq!(round_credit(f(&r["x"])), f(&r["credit"]), "{}", r["x"]);
    }
    for r in v["at_hour"].as_array().unwrap() {
        assert_eq!(at_hour(r["at_s"].as_u64().unwrap()), r["at_hour"].as_u64().unwrap());
    }
    for r in v["latency_s"].as_array().unwrap() {
        assert_eq!(latency_s(f(&r["seconds"])), r["latency_s"].as_u64().unwrap());
    }
    for r in v["draw"].as_array().unwrap() {
        close(Some(draw(f(&r["lo"]), f(&r["hi"]), f(&r["u"]))), Some(f(&r["value"])));
    }
    for r in v["settle"].as_array().unwrap() {
        let o = settle(
            f(&r["szi"]),
            f(&r["liq_before"]),
            f(&r["mark"]),
            r["liquidated"].as_bool().unwrap(),
            f(&r["age_s"]),
        );
        let want: Outcome = serde_json::from_value(r["outcome"].clone()).unwrap();
        assert_eq!(o, want);
    }
}

#[test]
fn preset_ranges_match() {
    for c in load("guard")["preset_ranges"].as_array().unwrap() {
        let preset: Preset = serde_json::from_value(c["preset"].clone()).unwrap();
        let got = preset_ranges(preset, f(&c["d0"]));
        let want = (!c["ranges"].is_null()).then(|| {
            let r = &c["ranges"];
            (
                [f(&r["line_range_pct"][0]), f(&r["line_range_pct"][1])],
                [f(&r["target_range_pct"][0]), f(&r["target_range_pct"][1])],
            )
        });
        assert_eq!(got, want, "{c}");
    }
}
