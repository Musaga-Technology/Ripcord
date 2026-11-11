# Ripcord replay harness: blind holdout predictions

Written and sealed on 2026-11-03, before any October 2026 price data was run through the harness. Only the sha256 of
this file is committed (crates/replay/holdout/predictions.sha256); the file is revealed after scoring.

## What is scored

- Code: ripcord commit 2c7d7da (crates/replay at that commit, ripcord-rules with SPEED_BOOST = 3).
- Data: Binance USDⓈ-M futures 1-minute klines, BTCUSDT, ETHUSDT, SOLUSDT, HYPEUSDT, from data.binance.vision:
  `python3 -I scripts/replay/fetch.py 2026-10 2026-10 --daily && python3 -I scripts/replay/fetch.py 2026-11 2026-11 --daily`
- Run: `cargo run -p ripcord-replay --release -- 2026-10 2026-10`: a $10K long and a $10K short opened every 12 h
  from 2026-10-01 00:00 UTC through 2026-10-31, each held 7 days (data through 2026-11-08), at BTC 10×/20×,
  ETH 10×/20×, SOL 5×/10×, HYPE 3×/5×; reserves 0.5×, 1×, 2× of margin; credit lands one bar (60 s) after a rescue fires.
- Tuning period, the only data the presets and SPEED_BOOST were chosen on: 2025-10 through 2026-06.

## Predictions

P1. In every cell with leverage at most 10× (BTC 10×, ETH 10×, SOL 5×, SOL 10×, HYPE 3×, HYPE 5×), at 1× and 2×
    reserves, Balanced with the speed-aware trigger liquidates at most 2.0 percentage points more positions than
    posting the same reserve upfront. (Tuning period: at most +1.28 pp.)
P2. In every cell (all 8 asset × leverage pairs, all 3 reserves), the speed-aware trigger liquidates no more
    positions than the plain trigger, for Balanced and for Lean.
P3. Balanced with the speed-aware trigger at a 1× reserve cuts liquidations by at least 60 % against no guard,
    averaged over the cells where an unguarded position was liquidated. (Tuning: 78.8 %.) Void if no unguarded
    position is liquidated in any cell.
P4. Summed over the 8 cells at 1× and 2× reserves, Lean with the speed-aware trigger liquidates at least as many
    positions (in %) as Balanced with the speed-aware trigger. (Tuning: 102.85 vs 99.99.)
P5. Balanced with the speed-aware trigger at a 1× reserve fires between 0.4 and 2.5 rescues per position, averaged
    over the 8 cells. (Tuning: 1.12.)
P6. Of those rescues, between 5 % and 60 % are saves (the price later crossed the liquidation price from before the
    rescue), averaged over the 8 cells. (Tuning: 22 %.)

Each prediction is scored pass or fail, and every result is published, including failures.

salt: 4d18ff2b33d529e24b8d46068242e70c48b51c86f5272fdedf004a119538f456
