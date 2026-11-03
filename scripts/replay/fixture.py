"""Writes the CI fixture for the crash replay tests: Binance USDⓈ-M 1-minute klines around the Oct 10 2025 crash
(cascade 20:50–21:30 UTC), Oct 10 12:00 → Oct 11 22:00 UTC, from the cache `fetch.py` fills.

    python3 -I scripts/replay/fetch.py 2025-10 2025-10 && python3 -I scripts/replay/fixture.py
"""
import datetime as dt, pathlib

CACHE = pathlib.Path.home() / '.cache' / 'ripcord-replay'
OUT = pathlib.Path(__file__).resolve().parents[2] / 'crates' / 'replay' / 'tests' / 'fixtures'
FROM = int(dt.datetime(2025, 10, 10, 12, tzinfo=dt.timezone.utc).timestamp() * 1000)
TO = int(dt.datetime(2025, 10, 11, 22, tzinfo=dt.timezone.utc).timestamp() * 1000)

OUT.mkdir(parents=True, exist_ok=True)
for sym in ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']:
    rows = [l for l in (CACHE / f'{sym}-1m-2025-10.csv').read_text().splitlines() if FROM <= int(l.split(',')[0]) < TO]
    (OUT / f'{sym}-2025-10-10.csv').write_text('\n'.join(rows) + '\n')
    print(sym, len(rows), 'bars')
