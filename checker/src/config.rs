//! Where the checker talks to, compiled in (and so covered by the attested code hash), never taken from input.
//! The default build is testnet; a mainnet build sets these at compile time (RIPCORD_* environment variables).

pub struct Network {
    pub outlayer_api: &'static str,
    pub rpc: &'static str,
    /// The guard registry contract, which becomes each guard wallet's policy controller.
    pub registry: &'static str,
    /// Ripcord's fee wallet (a 64-hex intents id): the only recipient besides the owner's own addresses.
    pub fee_wallet: &'static str,
    pub oneclick: &'static str,
    pub hyperliquid: &'static str,
}

pub const NET: Network = Network {
    outlayer_api: match option_env!("RIPCORD_OUTLAYER_API") {
        Some(v) => v,
        None => "https://testnet-api.outlayer.ai",
    },
    rpc: match option_env!("RIPCORD_RPC") {
        Some(v) => v,
        None => "https://rpc.testnet.near.org",
    },
    registry: match option_env!("RIPCORD_REGISTRY") {
        Some(v) => v,
        None => "ripcord-registry-db06d339.testnet",
    },
    // Ripcord's fee wallet's confidential identity: its 64-hex intents id. Unset (zeros) means no fee is charged,
    // so a build that forgets it can't send fees anywhere.
    fee_wallet: match option_env!("RIPCORD_FEE_WALLET") {
        Some(v) => v,
        None => "0000000000000000000000000000000000000000000000000000000000000000",
    },
    oneclick: "https://1click.chaindefuser.com",
    hyperliquid: "https://api.hyperliquid.xyz",
};

/// Deposit attached to `register_guard`: the wallet policy's storage plus the guard's own; the registry and
/// OutLayer refund what isn't used.
pub const REGISTER_DEPOSIT: u128 = 30_000_000_000_000_000_000_000;
pub const REGISTER_GAS: u64 = 200_000_000_000_000;

/// Seconds of distance history kept for the fall rate, and the rescue time a speed-aware trigger looks ahead
/// (docs/SPEC.md §3: 60 s until the measured p95 replaces it).
pub const HISTORY_S: f64 = 60.0;
pub const HORIZON_S: f64 = 60.0;

/// How many times a refunded rescue is fired again under a fresh key before the guard gives up on it.
pub const MAX_REFIRES: u32 = 2;
/// The $1 monthly guard fee, in USDC units.
pub const MONTHLY_FEE_UNITS: u128 = 1_000_000;

/// The hourly dry-run canary: on OutLayer's testnet confidential intents always answer 503, so there a canary
/// could only ever report the guard paused.
pub fn canary_on() -> bool {
    !NET.outlayer_api.contains("testnet")
}

/// Fees are charged only to a set fee wallet: 64 hex characters, not all zeros.
pub fn fees_on(fee_wallet: &str) -> bool {
    fee_wallet.len() == 64 && fee_wallet.bytes().all(|b| b.is_ascii_hexdigit()) && fee_wallet.bytes().any(|b| b != b'0')
}
