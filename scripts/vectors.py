#!/usr/bin/env python3
"""Reference implementation of Ripcord's shared rules (docs/SPEC.md §1, §3), standard library only.

It writes the golden vectors in packages/shared/vectors/. The TypeScript (packages/shared) and Rust (checker)
implementations are tested against these files, so three independent implementations must agree.
Run: python3 scripts/vectors.py   (CI fails if the committed vectors differ from a fresh run)
"""
import hashlib
import json
import math
import os
import re
from decimal import Decimal

OUT = os.path.join(os.path.dirname(__file__), '..', 'packages', 'shared', 'vectors')
ADDRESS = re.compile(r'^0x[0-9a-fA-F]{40}$')
HEX64 = re.compile(r'^[0-9a-f]{64}$')
KEY = re.compile(r'^[a-z0-9_]+$')
BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'


# ---------- canonical JSON ----------
def canonical_number(x):
    if isinstance(x, bool):
        raise ValueError('bool is not a number')
    if isinstance(x, float) and not math.isfinite(x):
        raise ValueError('number must be finite')
    if x == 0:
        return '0'
    if not (1e-6 <= abs(x) < 1e15):
        raise ValueError('number out of range')
    if isinstance(x, int) or float(x).is_integer():
        return str(int(x))
    return format(Decimal(repr(float(x))), 'f')


def canonical_string(s):
    if ADDRESS.match(s):
        s = s.lower()
    out = ['"']
    for ch in s:
        o = ord(ch)
        if 0xD800 <= o <= 0xDFFF:
            raise ValueError('lone surrogate')
        if ch == '"':
            out.append('\\"')
        elif ch == '\\':
            out.append('\\\\')
        elif ch == '\b':
            out.append('\\b')
        elif ch == '\f':
            out.append('\\f')
        elif ch == '\n':
            out.append('\\n')
        elif ch == '\r':
            out.append('\\r')
        elif ch == '\t':
            out.append('\\t')
        elif o < 0x20:
            out.append('\\u%04x' % o)
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


def canonical(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return '"' + canonical_number(v) + '"'
    if isinstance(v, str):
        return canonical_string(v)
    if isinstance(v, list):
        return '[' + ','.join(canonical(x) for x in v) + ']'
    if isinstance(v, dict):
        for k in v:
            if not KEY.match(k):
                raise ValueError('key must match [a-z0-9_]+')
        return '{' + ','.join(canonical_string(k) + ':' + canonical(v[k]) for k in sorted(v)) + '}'
    raise ValueError('unsupported type')


# ---------- hashes ----------
def sha256_hex(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def need_salt(salt):
    if not HEX64.match(salt):
        raise ValueError('salt must be 64 lowercase hex characters')


def commitment(settings, salt):
    need_salt(salt)
    return sha256_hex(canonical(settings) + salt)


def normalize_owner(owner):
    if ADDRESS.match(owner):
        return owner.lower()
    if re.match(r'^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$', owner):
        return owner
    raise ValueError('owner must be an EVM address or ed25519:<base58>')


def owner_salt(signature_hex):
    sig = signature_hex[2:] if signature_hex.startswith('0x') else signature_hex
    return hashlib.sha256(bytes.fromhex(sig)).hexdigest()


def owner_commitment(owner, salt):
    need_salt(salt)
    return sha256_hex(normalize_owner(owner) + salt)


def account_commitment(hl_address, salt):
    need_salt(salt)
    if not ADDRESS.match(hl_address):
        raise ValueError('hl_address must be an EVM address')
    return sha256_hex(hl_address.lower() + salt)


def fingerprint(c):
    u = c.upper()
    return f'{u[0:4]} {u[4:8]} ···· {u[-4:]}'


def fingerprint_short(c):
    u = c.upper()
    return f'{u[0:4]} ···· {u[-4:]}'


def guard_id_from_bits(n):
    if not (0 <= n < 2 ** 50):
        raise ValueError('need 50 bits')
    return 'g-' + ''.join(BASE32[(n >> (5 * (9 - i))) & 31] for i in range(10))


def is_guard_id(s):
    return re.fullmatch(r'g-[a-z2-7]{10}', s) is not None


# ---------- owner messages (docs/SPEC.md §2) ----------
NEP413_TAG = 2 ** 31 + 413


def nep413_hash(message, nonce, recipient):
    """sha256(borsh(tag) ‖ borsh(Payload{message, nonce: sha256(nonce), recipient, callback_url: None}))."""
    m, r = message.encode('utf-8'), recipient.encode('utf-8')
    b = NEP413_TAG.to_bytes(4, 'little') + len(m).to_bytes(4, 'little') + m
    b += hashlib.sha256(nonce.encode('utf-8')).digest() + len(r).to_bytes(4, 'little') + r + b'\x00'
    return hashlib.sha256(b).hexdigest()


def freeze_message(guard_id, nonce, frozen=True):
    return f"ripcord:{'freeze' if frozen else 'unfreeze'}:{guard_id}:{nonce}"


def policy_message(guard_id, encrypted_policy, nonce):
    return f'ripcord:policy:{guard_id}:{sha256_hex(encrypted_policy)}:{nonce}'


def publish_message(guard_id, index, proof, nonce):
    return f'ripcord:publish:{guard_id}:{index}:{sha256_hex(canonical(proof))}:{nonce}'


def close_message(guard_id, chain, address, nonce):
    return f'ripcord:close:{guard_id}:{chain}:{address}:{nonce}'


# ---------- guard logic ----------
def distance_pct(liquidation_px, mark):
    if liquidation_px is None:
        return None
    return abs(liquidation_px - mark) / mark * 100


def guard_distance(positions, isolated_coin):
    ds = []
    for p in positions:
        if isolated_coin is not None:
            if p['coin'] != isolated_coin:
                continue
        elif p['leverage_type'] != 'cross':
            continue
        mark = p['position_value'] / abs(p['szi'])
        d = distance_pct(p['liquidation_px'], mark)
        if d is not None:
            ds.append(d)
    return min(ds) if ds else None


def fall_rate(history, now_t, now_d, window_s=60):
    pts = [(t, d) for t, d in history if now_t - t <= window_s]
    if not pts:
        return 0.0
    t0, d0 = min(pts)
    span = now_t - t0
    if span < 1:
        return 0.0
    return max(0.0, (d0 - now_d) / span)


def should_fire(distance, drawn_line, speed_aware, v, horizon_s=60):
    if distance < drawn_line:
        return True
    return bool(speed_aware) and distance - v * horizon_s < drawn_line


def rescue_size(drawn_target, distance, mark, szi, maint_frac, max_rescue_usd, budget_left_usd, reserve_usd):
    side = 1 if szi > 0 else -1
    t = (drawn_target - distance) / 100 * mark * abs(szi) * (1 - maint_frac * side)
    t = min(t, max_rescue_usd, budget_left_usd, reserve_usd)
    return None if t < 5 else t


def save_fee(t):
    return 0.03 * min(t, 50000) + 0.005 * max(t - 50000, 0)


def round_credit(x):
    if x <= 0:
        return 0.0
    p = math.floor(math.log10(x)) - 1
    if p >= 0:
        return float(round_half_up(x / 10 ** p) * 10 ** p)
    return round_half_up(x * 10 ** -p) / 10 ** -p


def round_half_up(x):
    return math.floor(x + 0.5)


def at_hour(at_s):
    return (at_s // 3600) * 3600


def latency_s(seconds):
    return round_half_up(seconds)


def draw(lo, hi, u):
    return lo + u * (hi - lo)


def settle(szi, liq_before, mark, liquidated, age_s):
    if liquidated:
        return 'failed'
    if (szi > 0 and mark <= liq_before) or (szi < 0 and mark >= liq_before):
        return 'saved'
    return 'early' if age_s >= 86400 else 'pending'


# ---------- vectors ----------
SALT_A = '1f' * 32
SALT_B = hashlib.sha256(b'ripcord account salt').hexdigest()
SALT_C = hashlib.sha256(b'ripcord settings salt').hexdigest()

SETTINGS = {
    'owner': '0x9C4E7a1b2C3d4E5f60718293A4b5C6d7E8f941F2',
    'hl_address': '0x15A6116AEaCaa68fD69A17e8aBB9E77e24159Fe3',
    'account_salt': SALT_B,
    'preset': 'balanced',
    'line_range_pct': [5, 8],
    'target_range_pct': [9, 13],
    'speed_aware': False,
    'max_rescue_usd': 1500,
    'budget_usd': 4000,
    'reserve_asset': 'nep141:nbtc.bridge.near',
    'cooldown_s': 60,
    'isolated': None,
    'close_hint': None,
    'receipt_pk': 'x25519:7f3a91c2e04b5d18a6f2c3b9d07e41a2b6c8d9e0f1a2b3c4d5e6f708192ac91e',
    'expires_at': '1795046400000000000',
}
SETTINGS_LEAN = {**SETTINGS, 'preset': 'lean', 'line_range_pct': [3.5, 5.5], 'target_range_pct': [7, 10.25],
                 'speed_aware': True, 'isolated': {'coin': 'HYPE'},
                 'close_hint': {'chain': 'btc', 'address': 'bc1qexampleaddressxyz'}}


def vectors_commitment():
    canon = [
        {'input': {'b': 1, 'a': [True, False, None]}},
        {'input': {'x': 5.5, 'y': 0.1, 'z': 0.000001, 'w': 1500.0, 'v': -2.25, 'u': 0}},
        {'input': {'s': 'quote " backslash \\ tab \t newline \n bell \u0007 é ✓'}},
        {'input': {'addr': '0xAbCdEf0123456789aBcDeF0123456789ABCDEF01', 'not_addr': '0xABC'}},
        {'input': {'nested': {'z': {'k': [1, {'b': 2, 'a': 3}]}, 'a': []}}},
        {'input': SETTINGS},
    ]
    for c in canon:
        c['canonical'] = canonical(c['input'])
    rejects = [
        {'input': {'n': 1e15}, 'why': 'number out of range'},
        {'input': {'n': 1e-7}, 'why': 'number out of range'},
        {'input': {'Bad': 1}, 'why': 'key must match [a-z0-9_]+'},
    ]
    for r in rejects:
        try:
            canonical(r['input'])
            raise SystemExit('expected a rejection: %r' % r)
        except ValueError:
            pass
    commits = []
    for name, s, salt in [('balanced', SETTINGS, SALT_A), ('lean isolated', SETTINGS_LEAN, SALT_C)]:
        c = commitment(s, salt)
        commits.append({'name': name, 'settings': s, 'salt': salt, 'canonical': canonical(s), 'commitment': c,
                        'fingerprint': fingerprint(c), 'fingerprint_short': fingerprint_short(c)})
    sig_evm = '0x' + hashlib.sha512(b'evm sig').hexdigest() + 'a1'  # 65 bytes, shape only
    sig_ed = hashlib.sha512(b'ed25519 sig').hexdigest()  # 64 bytes
    owners = []
    for owner, sig in [('0x9C4E7a1b2C3d4E5f60718293A4b5C6d7E8f941F2', sig_evm),
                       ('ed25519:7Zo8xKX3yLnPmQrStUvWxYz123456789ABCDEFGHJKL', sig_ed)]:
        os_ = owner_salt(sig)
        owners.append({'owner': owner, 'signature': sig, 'owner_salt': os_,
                       'owner_commitment': owner_commitment(owner, os_)})
    accounts = [{'hl_address': SETTINGS['hl_address'], 'account_salt': SALT_B,
                 'account_commitment': account_commitment(SETTINGS['hl_address'], SALT_B)}]
    ids = [{'bits': b, 'guard_id': guard_id_from_bits(b)} for b in [0, 1, 2 ** 50 - 1, 0x2A5F3C91E04B7]]
    id_checks = [{'s': s, 'valid': is_guard_id(s)} for s in ['g-aaaaaaaaaa', 'g-7f3a91c2ek', 'g-AAAAAAAAAA', 'g-aaaa', 'g-aaaaaaaaa1', 'x-aaaaaaaaaa']]
    proof = {'at': 1793541381, 'hl_credit_usd': 1486.18, 'hl_tx': '0xabc'}
    messages = [
        {'kind': 'freeze', 'guard_id': 'g-vf6per4bfx', 'nonce': 'n1', 'message': freeze_message('g-vf6per4bfx', 'n1')},
        {'kind': 'unfreeze', 'guard_id': 'g-vf6per4bfx', 'nonce': 'n2', 'message': freeze_message('g-vf6per4bfx', 'n2', False)},
        {'kind': 'policy', 'guard_id': 'g-vf6per4bfx', 'nonce': 'p1', 'encrypted_policy': 'AdTcezsumL154jqA07',
         'message': policy_message('g-vf6per4bfx', 'AdTcezsumL154jqA07', 'p1')},
        {'kind': 'publish', 'guard_id': 'g-vf6per4bfx', 'nonce': 'p2', 'index': 0, 'proof': proof,
         'message': publish_message('g-vf6per4bfx', 0, proof, 'p2')},
        {'kind': 'close', 'guard_id': 'g-vf6per4bfx', 'nonce': 'c1', 'chain': 'btc', 'address': 'bc1qexample',
         'message': close_message('g-vf6per4bfx', 'btc', 'bc1qexample', 'c1')},
    ]
    nep413 = [{'message': m, 'nonce': n, 'recipient': r, 'hash': nep413_hash(m, n, r)}
              for m, n, r in [('ripcord:freeze:g-vf6per4bfx:n1', 'n1', 'registry.testnet'),
                              ('ripcord:freeze:g-vf6per4bfx:n1', 'n1', 'other-registry.testnet'),
                              ('héllo ✓', 'x', 'r.near')]]
    return {'canonical': canon, 'canonical_rejects': rejects, 'commitments': commits, 'owners': owners,
            'accounts': accounts, 'guard_ids': ids, 'guard_id_checks': id_checks, 'messages': messages, 'nep413': nep413}


def vectors_guard():
    positions = [
        {'coin': 'ETH', 'szi': 12.4, 'position_value': 29906.32, 'liquidation_px': 1995.10, 'leverage_type': 'cross'},
        {'coin': 'BTC', 'szi': -0.8, 'position_value': 66400.0, 'liquidation_px': 98940.0, 'leverage_type': 'cross'},
        {'coin': 'HYPE', 'szi': 300.0, 'position_value': 24594.0, 'liquidation_px': 55.30, 'leverage_type': 'isolated'},
        {'coin': 'SOL', 'szi': 140.0, 'position_value': 14978.6, 'liquidation_px': None, 'leverage_type': 'cross'},
    ]
    distance = [{'liquidation_px': lp, 'mark': m, 'distance_pct': distance_pct(lp, m)}
                for lp, m in [(1995.10, 2411.80), (98940.0, 83000.0), (None, 106.99), (2205.0, 2205.0)]]
    guard_d = [{'positions': positions, 'isolated_coin': ic, 'distance_pct': guard_distance(positions, ic)}
               for ic in [None, 'HYPE', 'DOGE']]
    hist = [(0, 9.0), (20, 8.4), (40, 7.6), (55, 7.0)]
    falls = [{'history': hist, 'now_t': 60, 'now_d': 6.8, 'v': fall_rate(hist, 60, 6.8)},
             {'history': hist, 'now_t': 130, 'now_d': 7.2, 'v': fall_rate(hist, 130, 7.2)},
             {'history': [(0, 5.0)], 'now_t': 0.5, 'now_d': 4.0, 'v': fall_rate([(0, 5.0)], 0.5, 4.0)},
             {'history': hist, 'now_t': 60, 'now_d': 9.5, 'v': fall_rate(hist, 60, 9.5)}]
    fires = [{'distance': d, 'drawn_line': l, 'speed_aware': sa, 'v': v, 'fire': should_fire(d, l, sa, v)}
             for d, l, sa, v in [(4.9, 5.2, False, 0), (6.0, 5.2, False, 0.05), (6.0, 5.2, True, 0.05),
                                 (6.0, 5.2, True, 0.01), (5.2, 5.2, False, 0)]]
    sizes = [dict(zip(['drawn_target', 'distance', 'mark', 'szi', 'maint_frac', 'max_rescue_usd', 'budget_left_usd', 'reserve_usd'], a))
             for a in [(11.0, 4.9, 2205.0, 12.4, 0.02, 5000, 5000, 5000), (11.0, 4.9, 2205.0, 12.4, 0.02, 1500, 5000, 5000),
                       (11.0, 4.9, 2205.0, 12.4, 0.02, 5000, 900, 5000), (11.0, 4.9, 83000.0, -0.8, 0.02, 9000, 9000, 9000),
                       (5.0, 4.95, 2205.0, 1.0, 0.02, 5000, 5000, 5000), (11.0, 4.9, 2205.0, 12.4, 0.02, 5000, 5000, 4.0)]]
    for s in sizes:
        s['size_usd'] = rescue_size(**s)
    fees = [{'t': t, 'fee': save_fee(t)} for t in [1486.18, 50000, 60000, 5]]
    rounding = [{'x': x, 'credit': round_credit(x)} for x in [1486.18, 640, 5.18, 99.5, 0.123, 12.0, 1949.99, 50000]]
    hours = [{'at_s': a, 'at_hour': at_hour(a)} for a in [1793541381, 1793541600, 1793541599]]
    lats = [{'seconds': s, 'latency_s': latency_s(s)} for s in [26.8, 30.5, 33.49]]
    draws = [{'lo': lo, 'hi': hi, 'u': u, 'value': draw(lo, hi, u)} for lo, hi, u in [(5, 8, 0), (5, 8, 0.5), (5, 8, 0.999), (9, 13, 0.25)]]
    settles = [{'szi': z, 'liq_before': lb, 'mark': m, 'liquidated': lq, 'age_s': a, 'outcome': settle(z, lb, m, lq, a)}
               for z, lb, m, lq, a in [(12.4, 2131.0, 2120.0, False, 3600), (12.4, 2131.0, 2200.0, False, 3600),
                                       (12.4, 2131.0, 2200.0, False, 86400), (-0.8, 90000.0, 90500.0, False, 10),
                                       (12.4, 2131.0, 1900.0, True, 100)]]
    return {'distance': distance, 'guard_distance': guard_d, 'fall_rate': falls, 'should_fire': fires, 'rescue_size': sizes,
            'save_fee': fees, 'round_credit': rounding, 'at_hour': hours, 'latency_s': lats, 'draw': draws, 'settle': settles}


def render(data):
    return json.dumps(data, indent=1, ensure_ascii=False) + '\n'


def main(check):
    os.makedirs(OUT, exist_ok=True)
    stale = []
    for name, data in [('commitment.json', vectors_commitment()), ('guard.json', vectors_guard())]:
        path = os.path.join(OUT, name)
        text = render(data)
        if check:
            with open(path, encoding='utf-8') as f:
                if f.read() != text:
                    stale.append(name)
        else:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(text)
            print('wrote', os.path.relpath(path))
    if stale:
        raise SystemExit('vectors differ from the reference implementation: ' + ', '.join(stale))
    if check:
        print('vectors match the reference implementation')


if __name__ == '__main__':
    import sys
    main('--check' in sys.argv)
