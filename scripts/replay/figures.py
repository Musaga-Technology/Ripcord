#!/usr/bin/env python3
"""Turns a replay table (`cargo run -p ripcord-replay --release -- 2025-10 2026-06`, on stdin) into the figures the set-up
screen shows: for each asset, leverage and reserve, the share liquidated with no guard, with the reserve posted upfront,
and under each preset, and that preset's early rescues per position per month. Speed-aware rows only, as every preset
runs speed-aware. Only the tuning months: the holdout stays unread until it is scored."""
import json
import re
import sys

ROW = re.compile(r'^(\w+)\s+(\d+)×\s+([\d.]+)×\s+(\w+)( \+speed)?\s+(\d+)\s+([\d.]+) %\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)')
DAYS_HELD = 7
out = {}
for line in sys.stdin:
    m = ROW.match(line)
    if not m:
        continue
    asset, lev, reserve, mode, speed, positions, liquidated, _rescues, _saved, early, _failed = m.groups()
    if mode in ('safer', 'balanced', 'lean') and not speed:
        continue
    cell = out.setdefault(asset, {}).setdefault(lev, {}).setdefault(reserve, {})
    if mode in ('unguarded', 'upfront'):
        cell[mode] = float(liquidated)
    else:
        early_month = int(early) / int(positions) * 30 / DAYS_HELD
        cell[mode] = {'liquidated': float(liquidated), 'early_month': round(early_month, 1)}
json.dump({'period': 'Oct 2025 to Jun 2026', 'held_days': DAYS_HELD, 'figures': out}, sys.stdout, indent=1, sort_keys=True)
print()
