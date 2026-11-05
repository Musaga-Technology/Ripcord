"""The edge, right now: the largest Hyperliquid positions near liquidation, from public data only.

Reads Hyperliquid's public leaderboard, takes the 1,500 largest accounts by value, reads each one's
`clearinghouseState` (weight 2; paced under the 1,200-per-minute limit), and writes apps/web/data/edge.json:
the five largest positions within 10 % of liquidation and the totals. Addresses are never written.

    python3 -I scripts/scan/edge.py
"""
import datetime as dt, json, pathlib, time, urllib.request

API = 'https://api.hyperliquid.xyz/info'
OUT = pathlib.Path(__file__).resolve().parents[2] / 'apps' / 'web' / 'data' / 'edge.json'
N = 1500


def post(body):
    req = urllib.request.Request(API, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'ripcord-scan/1.0'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(2 + attempt * 3)
    return None


def main():
    req = urllib.request.Request('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard', headers={'User-Agent': 'ripcord-scan/1.0'})
    rows = json.load(urllib.request.urlopen(req, timeout=120))['leaderboardRows']
    rows.sort(key=lambda r: -float(r['accountValue']))
    mids = {k: float(v) for k, v in post({'type': 'allMids'}).items()}
    near = []
    for i, r in enumerate(rows[:N]):
        s = post({'type': 'clearinghouseState', 'user': r['ethAddress']})
        time.sleep(0.11)  # ≈ 545 reads a minute, weight 2 each: under half the limit
        if not s:
            continue
        for ap in s.get('assetPositions', []):
            p = ap['position']
            szi, liq, mid = float(p['szi']), p.get('liquidationPx'), mids.get(p['coin'])
            if not szi or liq is None or not mid:
                continue
            dist = abs(float(liq) - mid) / mid * 100
            if dist < 10:
                near.append({'coin': p['coin'], 'side': 'long' if szi > 0 else 'short', 'notional': abs(szi) * mid,
                             'leverage': p['leverage']['value'], 'margin': p['leverage']['type'], 'distance_pct': dist})
    near.sort(key=lambda x: -x['notional'])
    within5 = [x for x in near if x['distance_pct'] < 5]
    out = {
        'scanned_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
        'accounts': min(N, len(rows)),
        'within_10_usd': round(sum(x['notional'] for x in near)),
        'within_10_count': len(near),
        'within_5_count': len(within5),
        'within_5_isolated': sum(1 for x in within5 if x['margin'] == 'isolated'),
        'top': [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in x.items()} for x in near[:5]],
    }
    OUT.write_text(json.dumps(out, indent=1) + '\n')
    print(json.dumps({k: v for k, v in out.items() if k != 'top'}))


if __name__ == '__main__':
    main()
