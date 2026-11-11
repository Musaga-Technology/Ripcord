# AGENTS.md

Notes for coding agents and reviewers working with this repository.

**What this is.** Ripcord, hidden margin for Hyperliquid: a guard that moves a trader's own reserve into their Hyperliquid margin before liquidation. Built for NEAR HACKATHON (window Oct 19 – Nov 14, 2026). Start with `README.md`.

**Run it.** `bash scripts/demo.sh` runs everything without funds (demo mode: recorded Hyperliquid snapshots, a mock rescue executor, the hunt simulator, crash replays). Prerequisites and step-by-step "do X → see Y" checks are in the README.

**Tests.**
```
pnpm install && pnpm -r test && pnpm -r build
cargo test --workspace            # shared rules, checker, guard-registry contract
cargo build -p guard-registry --release --target wasm32-unknown-unknown
bash contracts/guard-registry/build.sh   # the deployed contract: paths remapped, wasm-opt -Oz, prints its NEAR code hash
bash checker/build.sh                    # the enclave binary OutLayer runs, with its sha256
bash checker/build.sh mainnet            # the mainnet enclave: mainnet OutLayer, RPC, registry and fee wallet
```

**Where the evidence is.** The README's "Built on NEAR" table links each NEAR piece to its code (`file:line`) and to a test or mainnet transaction. `docs/EVIDENCE.md` maps every claim in the README to a test, file or transaction. Design and trust model: `docs/ARCHITECTURE.md`; exact interfaces: `docs/SPEC.md`; product design: `docs/DESIGN.md`.

**Layout.** `apps/web` (Next.js app), `packages/shared` (types, commitment and guard logic shared by web and poker), `services/poker` (public-data watcher), `crates/rules` (the Rust rules shared by checker and contract), `contracts/guard-registry` (NEAR contract), `checker` (the program sealed in OutLayer's TEE).

**Secrets.** None are committed. `.env.example` lists the variables; demo mode needs none of them.
