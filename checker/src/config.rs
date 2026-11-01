//! Where the checker talks to, compiled in (and so covered by the attested code hash), never taken from input.
//! The default build is testnet; a mainnet build sets these at compile time (RIPCORD_* environment variables).

pub struct Network {
    pub outlayer_api: &'static str,
    pub rpc: &'static str,
    /// The guard registry contract, which becomes each guard wallet's policy controller.
    pub registry: &'static str,
    /// Ripcord's fee wallet: the only recipient besides the owner's own addresses.
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
    fee_wallet: match option_env!("RIPCORD_FEE_WALLET") {
        Some(v) => v,
        None => "ripcord-registry-db06d339.testnet",
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
