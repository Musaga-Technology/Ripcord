#!/usr/bin/env bash
# Builds the checker's enclave binary the way it is published to OutLayer: Rust 1.85 (OutLayer's compiler notes,
# WASI 0.2.0/0.2.2 imports), wasm32-wasip2, feature `outlayer`. Prints the sha256 OutLayer attests, and checks the
# manifest section is embedded and no local path is.
#   bash checker/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
rustup toolchain install 1.85.0 --profile minimal --target wasm32-wasip2 >/dev/null
# Remap local paths (panic locations) so the binary carries no home directory and builds the same anywhere.
export RUSTFLAGS="--remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$PWD=/ripcord"
cargo +1.85.0 build -p ripcord-checker --release --target wasm32-wasip2 --features outlayer \
  --target-dir target/outlayer --locked
W=target/outlayer/wasm32-wasip2/release/ripcord-checker.wasm
python3 -I - "$W" checker/manifest.json <<'PY'
import hashlib, sys
wasm, manifest = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read()
assert wasm[:8] == b'\0asm\x0d\0\x01\0', 'not a WASI P2 component'
assert b'outlayer.manifest' in wasm and manifest in wasm, 'manifest section missing'
assert b'/Users/' not in wasm and b'/home/' not in wasm, 'a local path is embedded'
for name in (b'outlayer:signing-keys/api', b'outlayer:encryption-keys/api', b'near:storage/api'):
    assert name in wasm, f'{name.decode()} not imported'
print(f'{sys.argv[1]}  {len(wasm):,} bytes  sha256 {hashlib.sha256(wasm).hexdigest()}')
PY
