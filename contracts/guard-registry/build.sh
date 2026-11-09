#!/usr/bin/env bash
# Builds the guard registry the way it is deployed to NEAR: wasm32-unknown-unknown with the MVP feature set,
# local paths remapped (no home directory in a public contract, and the same bytes on any machine), then Binaryen's
# wasm-opt -Oz, which packs the same code smaller (storage on NEAR costs 1 NEAR per 100 KB). Prints the size and
# the code hash NEAR shows for the account (base58 sha256), so anyone can rebuild and compare.
#   bash contracts/guard-registry/build.sh        # needs wasm-opt (brew install binaryen)
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.cargo/bin:$PATH"
command -v wasm-opt >/dev/null || { echo "wasm-opt not found: brew install binaryen" >&2; exit 1; }
# RUSTFLAGS replaces .cargo/config.toml's flags for this target, so they are repeated here.
export RUSTFLAGS="--cfg near -C link-arg=-s -C target-cpu=mvp \
  --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$PWD=/ripcord"
cargo build -p guard-registry --release --target wasm32-unknown-unknown --target-dir target/near --locked
IN=target/near/wasm32-unknown-unknown/release/guard_registry.wasm
OUT=target/near/guard_registry.wasm
# Only the features already in the file: our crates build for the MVP, and Rust's prebuilt standard library adds
# sign extension and memory.copy, which NEAR runs (protocol 88; the testnet registry carries both). wasm-opt must
# not add any other.
wasm-opt -Oz --mvp-features --enable-sign-ext --enable-bulk-memory-opt --strip-debug --strip-producers \
  --strip-target-features "$IN" -o "$OUT"
python3 -I - "$IN" "$OUT" "$(rustc --version)" "$(wasm-opt --version)" <<'PY'
import hashlib, sys
raw, wasm = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read()
assert wasm[:8] == b'\0asm\x01\0\0\0', 'not a core wasm module'
assert b'/Users/' not in wasm and b'/home/' not in wasm, 'a local path is embedded'
digest = hashlib.sha256(wasm).digest()
A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n, b58 = int.from_bytes(digest, 'big'), ''
while n:
    n, r = divmod(n, 58)
    b58 = A[r] + b58
print(f'{sys.argv[3]}; {sys.argv[4]}')
print(f'{len(raw):,} bytes from cargo, {len(wasm):,} after wasm-opt ({100 * (1 - len(wasm) / len(raw)):.1f}% smaller)')
print(f'{sys.argv[2]}  sha256 {digest.hex()}  NEAR code hash {b58}')
print(f'storage ≈ {len(wasm) / 1e5:.2f} NEAR')
PY
