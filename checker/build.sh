#!/usr/bin/env bash
# Builds the checker's enclave binary the way it is published to OutLayer: Rust 1.85 (OutLayer's compiler notes,
# WASI 0.2.0/0.2.2 imports), wasm32-wasip2, feature `outlayer`. Prints the sha256 OutLayer attests, and checks the
# manifest section is embedded and no local path is.
#   bash checker/build.sh            # testnet
#   bash checker/build.sh mainnet    # mainnet: what ripcord-registry.near/checker runs
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
NETWORK=${1:-testnet}
if [ "$NETWORK" = mainnet ]; then
  # Where the mainnet enclave talks to, compiled in (checker/src/config.rs) so the attested hash covers them. The RPC
  # is one the manifest's network list already allows.
  export RIPCORD_OUTLAYER_API=https://api.outlayer.ai RIPCORD_RPC=https://rpc.mainnet.near.org \
    RIPCORD_REGISTRY=ripcord-registry.near
  # Ripcord's fee wallet: an OutLayer custody wallet's 64-hex NEAR id, the `to` of a confidential transfer. Every
  # guard wallet's policy lists it, so it is public; the fees it holds are not.
  export RIPCORD_FEE_WALLET=7b3d43bb4178e2ca10e57a2e3103afc20ba8a775d39138fc939329fcc9bc190f
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
python3 -I - "$W" checker/manifest.json "$NETWORK" "${RIPCORD_FEE_WALLET:-}" <<'PY'
import hashlib, sys
wasm, manifest = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read()
# The registry compiled in is the network's (the manifest names both networks' hosts, so hosts can't tell).
ours, theirs = b'ripcord-registry.near', b'ripcord-registry-db06d339.testnet'
if sys.argv[3] != 'mainnet':
    ours, theirs = theirs, ours
assert ours in wasm and theirs not in wasm, "the registry compiled in is not the network's"
assert not sys.argv[4] or sys.argv[4].encode() in wasm, 'the fee wallet is not compiled in'
assert wasm[:8] == b'\0asm\x0d\0\x01\0', 'not a WASI P2 component'
assert b'outlayer.manifest' in wasm and manifest in wasm, 'manifest section missing'
assert b'/Users/' not in wasm and b'/home/' not in wasm, 'a local path is embedded'
for name in (b'outlayer:signing-keys/api', b'outlayer:encryption-keys/api', b'near:storage/api'):
    assert name in wasm, f'{name.decode()} not imported'
print(f'{sys.argv[3]}: {sys.argv[1]}  {len(wasm):,} bytes  sha256 {hashlib.sha256(wasm).hexdigest()}')
PY
