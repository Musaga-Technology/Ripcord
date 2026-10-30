//! Ripcord's checker: the program sealed in OutLayer's TEE. Pure logic lives here and is tested natively against a
//! mock host; `src/main.rs` (feature `outlayer`) wires it to OutLayer's interfaces for the wasm32-wasip2 build.
pub mod actions;
pub mod config;
pub mod custody;
pub mod host;
pub mod near_tx;
pub mod oneclick;
pub mod policy;
pub mod settings;
pub mod vault;

pub use ripcord_rules::{canonical, commitment, guard, seal, types};
