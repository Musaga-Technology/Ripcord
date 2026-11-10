#!/usr/bin/env bash
# Builds the checker's enclave binary the way it is published to OutLayer: Rust 1.85 (OutLayer's compiler notes,
# WASI 0.2.0/0.2.2 imports), wasm32-wasip2, feature `outlayer`. Prints the sha256 OutLayer attests, and checks the
# manifest section is embedded and no local path is.
#   bash checker/build.sh                                         # testnet
#   RIPCORD_FEE_WALLET=<64-hex intents id> bash checker/build.sh mainnet
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
NETWORK=${1:-testnet}
if [ "$NETWORK" = mainnet ]; then
  # Where the mainnet enclave talks to, compiled in (checker/src/config.rs) so the attested hash covers them.
  # FastNEAR's free endpoint is a public mainnet RPC listed in NEAR's docs (docs.near.org/api/rpc/providers).
  export RIPCORD_OUTLAYER_API=https://api.outlayer.ai RIPCORD_RPC=https://free.rpc.fastnear.com \
    RIPCORD_REGISTRY=ripcord-registry.near
  [[ "${RIPCORD_FEE_WALLET:-}" =~ ^[0-9a-f]{64}$ ]] || { echo "set RIPCORD_FEE_WALLET to the fee wallet's 64-hex intents id" >&2; exit 1; }
  DIR=target/outlayer-mainnet
elif [ "$NETWORK" = testnet ]; then
  unset RIPCORD_OUTLAYER_API RIPCORD_RPC RIPCORD_REGISTRY RIPCORD_FEE_WALLET
  DIR=target/outlayer
else
  echo "usage: bash checker/build.sh [testnet|mainnet]" >&2
  exit 2
fi
rustup toolchain install 1.85.0 --profile minimal --target wasm32-wasip2 >/dev/null
# Remap local paths (panic locations) so the binary carries no home directory and builds the same anywhere.
export RUSTFLAGS="--remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$PWD=/ripcord"
cargo +1.85.0 build -p ripcord-checker --release --target wasm32-wasip2 --features outlayer \
  --target-dir "$DIR" --locked
W=$DIR/wasm32-wasip2/release/ripcord-checker.wasm
python3 -I - "$W" checker/manifest.json "$NETWORK" <<'PY'
import hashlib, sys
wasm, manifest = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read()
mainnet = sys.argv[3] == 'mainnet'
assert (b'ripcord-registry.near' in wasm) == mainnet, 'the registry is not the network\'s'
assert (b'testnet-api.outlayer.ai' in wasm) != mainnet, 'OutLayer is not the network\'s'
assert wasm[:8] == b'\0asm\x0d\0\x01\0', 'not a WASI P2 component'
assert b'outlayer.manifest' in wasm and manifest in wasm, 'manifest section missing'
assert b'/Users/' not in wasm and b'/home/' not in wasm, 'a local path is embedded'
for name in (b'outlayer:signing-keys/api', b'outlayer:encryption-keys/api', b'near:storage/api'):
    assert name in wasm, f'{name.decode()} not imported'
print(f'{sys.argv[3]}: {sys.argv[1]}  {len(wasm):,} bytes  sha256 {hashlib.sha256(wasm).hexdigest()}')
PY
