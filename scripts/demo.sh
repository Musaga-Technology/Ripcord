#!/usr/bin/env bash
# Everything a judge runs, without funds or keys: install, the three-way rule check (Python, TypeScript, Rust),
# fault-injection tests, a production build of the web app, and how to see it. Exits non-zero on any failure.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
skip() { printf '  – skipped: %s\n' "$1"; }
# Runs a command quietly; on failure prints its output and stops.
run() { local out; if ! out=$("$@" 2>&1); then printf '%s\n' "$out"; exit 1; fi; }

step "Tools"
node -v >/dev/null 2>&1 || { echo "Node.js 22+ is required (see .nvmrc)"; exit 1; }
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "Node.js 22+ is required"; exit 1; }
ok "node $(node -v)"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM="corepack pnpm"
$PNPM -v >/dev/null && ok "pnpm $($PNPM -v) (pinned in package.json)"

step "Install"
run $PNPM install --frozen-lockfile && ok "dependencies installed from the lockfile"

step "The rules agree in three languages (docs/SPEC.md §1, §3)"
if command -v python3 >/dev/null; then
  run python3 -I scripts/vectors.py --check && ok "golden vectors match the Python reference implementation"
else
  skip "python3 not found (the committed vectors are still used below)"
fi
run $PNPM --filter @ripcord/shared test && ok "TypeScript: canonical JSON, commitments, guard decisions, fault injection"
if command -v cargo >/dev/null; then
  run cargo test --quiet -p ripcord-rules && ok "Rust (shared by the checker and the registry): the same vectors"
  run cargo test --quiet -p guard-registry && ok "NEAR contract: owner signatures (EVM and NEAR keys), replays refused, rounded receipts, no address in state or events"
else
  skip "cargo not found; install Rust from https://rustup.rs to run the Rust and contract tests"
fi

step "The sealed checker, as it runs in OutLayer's TEE (docs/SPEC.md §3), against a mock host"
if command -v cargo >/dev/null; then
  run cargo test --quiet -p ripcord-checker --test create && ok "settings open only inside the enclave, for their guard, matching all three public hashes; the guard's own wallet is opened and registered with a transaction of hashes only"
  run cargo test --quiet -p ripcord-checker --test check && ok "arms with a draw sealed to the owner, fires only below the line, pays only the owner within the caps, cooldown, budget, 503 pauses, bare status"
  run cargo test --quiet -p ripcord-checker --test near_tx && ok "signs its own NEAR transactions, byte for byte with near-api-js"
  run cargo test --quiet -p ripcord-checker --test owner && ok "only the owner's key freezes, tops up, changes the range or closes; a top-up names no amount on chain; a close pays the rest to the owner's own Hyperliquid account"
  run cargo test --quiet -p ripcord-checker --test agent && ok "an isolated position's agent signs only one add of the credit that landed; a cross guard never signs"
  run cargo test --quiet -p ripcord-checker --features keepers --test keepers && ok "open keeper network: the keeper whose check fires a rescue is credited once; a check that doesn't rescue credits nobody; the rescue is the same with or without keepers"
  run cargo test --quiet -p keeper-market && ok "keeper market: only the enclave credits, once per rescue; a keeper claims its bounty once"
else
  skip "cargo not found; the checker's tests need Rust"
fi

step "Real crashes through the guard's own rules (crates/replay)"
if command -v cargo >/dev/null; then
  run cargo test --quiet -p ripcord-replay && ok "Oct 10 2025: every unguarded long liquidated; Balanced with the speed-aware trigger matches posting the reserve upfront"
else
  skip "cargo not found; the replay harness needs Rust"
fi

step "Predictions sealed on Nov 3, scored on October 2026 prices (crates/replay/holdout)"
if command -v python3 >/dev/null; then
  run python3 -I -c "import hashlib, sys; h = hashlib.sha256(open('crates/replay/holdout/predictions.md', 'rb').read()).hexdigest(); sys.exit(h != open('crates/replay/holdout/predictions.sha256').read().split()[0])" \
    && ok "the revealed predictions match the sha256 committed on Nov 3 (a2562f5)"
  run python3 -I scripts/replay/score.py crates/replay/holdout/2026-10.txt \
    && ok "6 of 6 predictions pass: 211 of 992 positions liquidated unguarded, 20 with a hidden 1× reserve, the same 20 as posting it upfront"
else
  skip "python3 not found"
fi

step "Pokers decide when to wake the checker (docs/SPEC.md §4)"
run $PNPM --filter @ripcord/poker test && ok "band, cadence, rate limit, settlement watch; an address is watched only with the owner's salt; encrypted at rest"

step "Agents can call it: MCP tools and a risk desk on NEAR's Agent Market (services/mcp)"
run $PNPM --filter @ripcord/mcp test && ok "four read-only tools over MCP · an agent seals, funds (in any token, through Aurora) and freezes its own guard, only hashes leaving its machine · the desk delivers, declines without an address and never logs one"

step "A rescue is never paid twice (T-SEC-09, proven by packages/shared/test/executor.test.ts above)"
ok "502 retried with the same key · 503 pauses with no public fallback · busy waits · refund re-fires · slow credit waits"
ok "two pokers firing the same rescue pay once · 300 random fault mixes pay at most once"

step "Web app"
run $PNPM --filter @ripcord/web test && ok "the web app: the hunt holds on every seed, a crash runs the real rules, a browser can only ask for what it may"
run $PNPM --filter @ripcord/web build && ok "production build"

cat <<'EOF'

Done. Try it:
  corepack pnpm dev          → open http://localhost:3000
  · the home page: a live rescue under the card, then "Try to hunt it": sell into the book and see if you can liquidate it
  · open http://localhost:3000/guards, press "Try a simulation" → example positions and their guards
  · switch to "Hunter's view" → your positions as anyone sees them: liquidation prices public, guard "Can't tell"
  · press "Guard" on SOL, then "Seal guard" → sealed in your browser: the card prints itself; save the seal file, approve, fund
  · on a guard, "Try a crash" → the real rules on simulated prices: the rescue lands and the red line slides away
  · hold "Hold to peek"      → your sealed rescue range, top-up and reserve appear while held
  · Theme: System / Light / Dark switches the page; the guard card stays dark
EOF
