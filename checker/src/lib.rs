//! Ripcord's checker. Day 1: the shared rules (canonical JSON, commitments, guard decisions) that must agree
//! byte for byte with `packages/shared` and `scripts/vectors.py`; the OutLayer binary comes on Day 3.
pub mod canonical;
pub mod commitment;
pub mod guard;
pub mod types;
