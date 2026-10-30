//! Ripcord's shared rules, one Rust implementation used by the checker (in OutLayer's TEE) and the
//! guard-registry contract. Tested against the same golden vectors as `packages/shared` (TypeScript) and
//! `scripts/vectors.py` (the Python reference), so all three agree byte for byte.
pub mod canonical;
pub mod commitment;
pub mod guard;
#[cfg(feature = "seal")]
pub mod seal;
pub mod types;
