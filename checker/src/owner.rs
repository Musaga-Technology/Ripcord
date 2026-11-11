//! What an owner signs (docs/SPEC.md §2), checked here for the owner actions the enclave carries out itself:
//! closing a guard, topping up its reserve and changing its range. Same bytes as packages/shared/src/owner.ts and the
//! registry's `sig.rs`.
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

/// NEP-413 tag: 2^31 + 413, first in the hash so a signed message can't be replayed as a transaction.
const NEP413_TAG: u32 = 2_147_484_061;

pub fn close_message(guard_id: &str, chain: &str, address: &str, nonce: &str) -> String {
    format!("ripcord:close:{guard_id}:{chain}:{address}:{nonce}")
}

/// Hides a top-up's amount: the owner signs this, the registry sees only this, and the enclave opens the amount.
pub fn topup_digest(guard_id: &str, cents: u64, salt: &str) -> String {
    hex::encode(Sha256::digest(format!(
        "ripcord:topup-amount:{guard_id}:{cents}:{salt}"
    )))
}

pub fn topup_message(guard_id: &str, digest: &str, nonce: &str) -> String {
    format!("ripcord:topup:{guard_id}:{digest}:{nonce}")
}

/// A new rescue range: the owner signs the settings' new fingerprint.
pub fn reseal_message(guard_id: &str, commitment: &str, nonce: &str) -> String {
    format!("ripcord:reseal:{guard_id}:{commitment}:{nonce}")
}

/// sha256(borsh(tag) ‖ borsh(Payload { message, nonce: sha256(nonce), recipient, callback_url: None })).
pub fn nep413_hash(message: &str, nonce: &str, recipient: &str) -> [u8; 32] {
    let mut b = Vec::with_capacity(4 + 4 + message.len() + 32 + 4 + recipient.len() + 1);
    b.extend_from_slice(&NEP413_TAG.to_le_bytes());
    b.extend_from_slice(&(message.len() as u32).to_le_bytes());
    b.extend_from_slice(message.as_bytes());
    b.extend_from_slice(&Sha256::digest(nonce.as_bytes()));
    b.extend_from_slice(&(recipient.len() as u32).to_le_bytes());
    b.extend_from_slice(recipient.as_bytes());
    b.push(0);
    Sha256::digest(&b).into()
}

/// True when `sig_hex` is the NEP-413 signature of `message` by `owner`, an ed25519 key written `ed25519:<base58>`
/// (the owner key the app makes and keeps in the seal file).
pub fn verify(owner: &str, message: &str, nonce: &str, sig_hex: &str, recipient: &str) -> bool {
    let key = owner
        .strip_prefix("ed25519:")
        .and_then(|b58| bs58::decode(b58).into_vec().ok())
        .and_then(|v| <[u8; 32]>::try_from(v.as_slice()).ok())
        .and_then(|k| VerifyingKey::from_bytes(&k).ok());
    let sig = hex::decode(sig_hex.trim_start_matches("0x"))
        .ok()
        .and_then(|v| <[u8; 64]>::try_from(v.as_slice()).ok());
    match (key, sig) {
        (Some(k), Some(s)) => k
            .verify_strict(&nep413_hash(message, nonce, recipient), &Signature::from_bytes(&s))
            .is_ok(),
        _ => false,
    }
}
