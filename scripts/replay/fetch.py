"""Downloads Binance USDⓈ-M futures 1-minute klines (data.binance.vision, public) for the crash replay harness.

Files are cached outside the repository, in ~/.cache/ripcord-replay/<SYMBOL>-1m-<YYYY-MM>.csv (monthly) or
-<YYYY-MM-DD>.csv (daily, for the current month). Only open time, high, low and close are kept.

    python3 -I scripts/replay/fetch.py 2025-10 2026-06            # the tuning period
    python3 -I scripts/replay/fetch.py 2026-10 2026-11 --daily    # the holdout, day by day as it arrives
"""
import argparse, csv, datetime as dt, io, pathlib, sys, urllib.error, urllib.request, zipfile

BASE = 'https://data.binance.vision/data/futures/um'
SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'HYPEUSDT']
CACHE = pathlib.Path.home() / '.cache' / 'ripcord-replay'


def months(a, b):
    y, m = map(int, a.split('-'))
    y2, m2 = map(int, b.split('-'))
    while (y, m) <= (y2, m2):
        yield f'{y:04d}-{m:02d}'
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ripcord-replay/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def save(raw, out):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        rows = csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]), 'utf-8'))
        tmp = out.with_suffix('.tmp')
        with tmp.open('w', newline='') as f:
            w = csv.writer(f)
            for r in rows:
                if not r or not r[0].isdigit():  # newer files start with a header row
                    continue
                w.writerow([r[0], r[2], r[3], r[4]])  # open time (ms), high, low, close
        tmp.rename(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('start')
    p.add_argument('end')
    p.add_argument('--daily', action='store_true', help='daily files (months Binance has not packed yet)')
    p.add_argument('--symbols', default=','.join(SYMBOLS))
    a = p.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    today = dt.date.today()
    for sym in a.symbols.split(','):
        for month in months(a.start, a.end):
            if a.daily:
                y, m = map(int, month.split('-'))
                d = dt.date(y, m, 1)
                while d.month == m and d < today:
                    name = f'{sym}-1m-{d.isoformat()}'
                    out = CACHE / f'{name}.csv'
                    if not out.exists():
                        raw = get(f'{BASE}/daily/klines/{sym}/1m/{name}.zip')
                        if raw:
                            save(raw, out)
                        print(f'{name}: {"ok" if raw else "not published yet"}')
                    d += dt.timedelta(days=1)
            else:
                name = f'{sym}-1m-{month}'
                out = CACHE / f'{name}.csv'
                if out.exists():
                    continue
                raw = get(f'{BASE}/monthly/klines/{sym}/1m/{name}.zip')
                if raw:
                    save(raw, out)
                print(f'{name}: {"ok" if raw else "missing"}', flush=True)


if __name__ == '__main__':
    sys.exit(main())
