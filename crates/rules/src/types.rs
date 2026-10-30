//! Shared shapes (docs/SPEC.md §1–2). Mirrors `packages/shared/src/types.ts` and the guard-registry contract.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Safer,
    Balanced,
    Lean,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Isolated {
    pub coin: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CloseHint {
    pub chain: String,
    pub address: String,
}

/// Sealed and committed; only the owner's device and this enclave ever see it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GuardSettings {
    /// EVM address (0x…, EIP-191) or `ed25519:<base58>` (NEP-413). Never a NEAR account name.
    pub owner: String,
    pub hl_address: String,
    /// 64 lowercase hex characters.
    pub account_salt: String,
    pub preset: Preset,
    pub line_range_pct: [f64; 2],
    pub target_range_pct: [f64; 2],
    pub speed_aware: bool,
    pub max_rescue_usd: f64,
    pub budget_usd: f64,
    /// 1Click asset id, e.g. `nep141:nbtc.bridge.near`.
    pub reserve_asset: String,
    pub cooldown_s: u64,
    pub isolated: Option<Isolated>,
    pub close_hint: Option<CloseHint>,
    /// The owner's X25519 key, for sealed receipts and arm records.
    pub receipt_pk: String,
    /// Nanoseconds since the epoch, as a decimal string.
    pub expires_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GuardStatus {
    Pending,
    Guarding,
    Closed,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Pending,
    Saved,
    Early,
    Failed,
}

/// Public part of a receipt, rounded so a rescue can't be matched to an account (ARCHITECTURE §2 rule 6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublicReceipt {
    pub at_hour: u64,
    pub credit_usd: f64,
    pub attestation_ref: String,
    pub latency_s: u64,
    pub outcome: Outcome,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proof {
    pub at: u64,
    pub hl_credit_usd: f64,
    pub hl_tx: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RescueReceipt {
    pub public: PublicReceipt,
    /// Exact amounts, encrypted to the owner's receipt key.
    pub sealed: String,
    pub proof: Option<Proof>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArmRecord {
    pub at: u64,
    pub epoch: u64,
    /// The drawn line and target, encrypted to the owner.
    pub sealed: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LeverageType {
    Cross,
    Isolated,
}

/// One Hyperliquid position as the guard reads it from `clearinghouseState`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub coin: String,
    pub szi: f64,
    pub position_value: f64,
    pub liquidation_px: Option<f64>,
    pub leverage_type: LeverageType,
}

/// Checker output: a status and nothing else (rule 4, T-PRIV-03).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Guarding,
    Rescued,
    Pending,
    Skipped,
}
