"""Scores the sealed holdout predictions (crates/replay/holdout/predictions.md, P1–P6) from a replay table.

The table is what `cargo run -p ripcord-replay --release -- <from> <to>` prints at commit 2c7d7da. Scoring the
tuning table reproduces every tuning figure the predictions quote (+1.28 pp, 78.8 %, 102.85 vs 99.99, 1.12, 22 %),
so the predictions are read the way they were written.

    python3 -I scripts/replay/score.py crates/replay/holdout/2026-10.txt   # the holdout: October 2026
    python3 -I scripts/replay/score.py crates/replay/holdout/tuning.txt    # the tuning months, for comparison

Exits with the number of predictions that failed.
"""
import re
import sys

ROW = re.compile(r'(\w+)\s+(\d+)×\s+([\d.]+)×\s+(\S+(?: \+speed)?)\s+(\d+)\s+([\d.]+) %\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)')
ORDER = ['BTC', 'ETH', 'SOL', 'HYPE']
LOW = {('BTC', 10), ('ETH', 10), ('SOL', 5), ('SOL', 10), ('HYPE', 3), ('HYPE', 5)}  # leverage at most 10×
B, BS, L, LS, U, UP = 'balanced', 'balanced +speed', 'lean', 'lean +speed', 'unguarded', 'upfront'


def load(path):
    rows = {}
    for line in open(path, encoding='utf-8'):
        m = ROW.match(line)
        if m:
            asset, lev, reserve, mode = m.group(1), int(m.group(2)), float(m.group(3)), m.group(4)
            positions, liq = int(m.group(5)), float(m.group(6))
            rescues, saved = int(m.group(7)), int(m.group(8))
            rows[(asset, lev, reserve, mode)] = {'positions': positions, 'liq': liq, 'rescues': rescues, 'saved': saved}
    return rows


def main(path):
    rows = load(path)
    cells = sorted({(a, lev) for a, lev, _, _ in rows}, key=lambda c: (ORDER.index(c[0]), c[1]))
    assert len(cells) == 8 and len(rows) == 8 * 3 * 7, f'{path}: expected 8 cells × 3 reserves × 7 modes'
    get = lambda c, reserve, mode: rows[(c[0], c[1], reserve, mode)]
    results = []

    def report(name, passed, line, details=()):
        results.append(passed)
        print(f'{name} {"pass" if passed else "FAIL"}  {line}')
        for d in details:
            print(f'     {d}')

    gaps = [(c, x, get(c, x, BS)['liq'] - get(c, x, UP)['liq']) for c in cells if c in LOW for x in (1.0, 2.0)]
    worst = max(g for _, _, g in gaps)
    report('P1', worst <= 2.0, f'Balanced+speed vs reserve upfront, ≤ 10×, 1× and 2× reserves: worst gap {worst:+.2f} pp '
           '(limit +2.00)', [f'{c[0]} {c[1]}× at {x:g}×: {g:+.2f} pp' for c, x, g in gaps if g > 0])

    worse = [(c, x, p) for c in cells for x in (0.5, 1.0, 2.0) for p in (B, L)
             if get(c, x, p + ' +speed')['liq'] > get(c, x, p)['liq']]
    report('P2', not worse, f'speed-aware liquidates more than plain in {len(worse)} of {len(cells) * 3 * 2} cases',
           [f'{c[0]} {c[1]}× at {x:g}× {p}' for c, x, p in worse])

    hit = [c for c in cells if get(c, 1.0, U)['liq'] > 0]
    if not hit:
        report('P3', True, 'void: no unguarded position was liquidated')
    else:
        cuts = [(c, 1 - get(c, 1.0, BS)['liq'] / get(c, 1.0, U)['liq']) for c in hit]
        avg = sum(x for _, x in cuts) / len(cuts)
        report('P3', avg >= 0.6, f'Balanced+speed at 1× cuts liquidations by {avg * 100:.1f} % on average vs no guard, over '
               f'{len(cuts)} cells where unguarded positions were liquidated (at least 60 %)',
               [f'{c[0]} {c[1]}×: {get(c, 1.0, U)["liq"]:.2f} % → {get(c, 1.0, BS)["liq"]:.2f} %' for c, _ in cuts])

    lean = sum(get(c, x, LS)['liq'] for c in cells for x in (1.0, 2.0))
    bal = sum(get(c, x, BS)['liq'] for c in cells for x in (1.0, 2.0))
    report('P4', lean >= bal, f'summed liquidations at 1× and 2×: Lean+speed {lean:.2f} vs Balanced+speed {bal:.2f} '
           '(Lean at least as many)')

    per = sum(get(c, 1.0, BS)['rescues'] / get(c, 1.0, BS)['positions'] for c in cells) / len(cells)
    report('P5', 0.4 <= per <= 2.5, f'Balanced+speed at 1×: {per:.2f} rescues per position (0.4 to 2.5)')

    shares = [get(c, 1.0, BS)['saved'] / get(c, 1.0, BS)['rescues'] for c in cells if get(c, 1.0, BS)['rescues']]
    share = sum(shares) / len(shares)
    report('P6', 0.05 <= share <= 0.6, f'of those rescues, {share * 100:.1f} % were saves, averaged over {len(shares)} cells '
           '(5 % to 60 %)')

    n = sum(r['positions'] for (a, lev, x, m), r in rows.items() if x == 1.0 and m == U)
    count = lambda mode: round(sum(r['liq'] * r['positions'] / 100 for (a, lev, x, m), r in rows.items()
                                   if x == 1.0 and m == mode))
    print(f'\n{n} positions at a 1× reserve: {count(U)} liquidated unguarded, {count(UP)} with the reserve posted '
          f'upfront, {count(BS)} with Balanced+speed holding it hidden')
    print(f'{sum(results)} of {len(results)} predictions pass')
    return len(results) - sum(results)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'crates/replay/holdout/2026-10.txt'))
