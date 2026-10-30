//! Hashes that let the public registry hold a guard without its owner or account (docs/SPEC.md §1).
//! Salts are 64 lowercase hex characters; ‖ joins UTF-8 text. Mirrors `packages/shared/src/commitment.ts`.
use crate::canonical::{canonical, CanonicalError};
use crate::types::GuardSettings;
use sha2::{Digest, Sha256};

const BASE32: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

#[derive(Debug, PartialEq, Eq)]
pub enum HashError {
    Salt,
    Owner,
    Address,
    Signature,
    Canonical(CanonicalError),
}

fn sha256_hex(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}

fn is_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn need_salt(salt: &str) -> Result<(), HashError> {
    if salt.len() == 64 && salt.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        Ok(())
    } else {
        Err(HashError::Salt)
    }
}

pub fn commitment(settings: &GuardSettings, salt: &str) -> Result<String, HashError> {
    need_salt(salt)?;
    let value = serde_json::to_value(settings).expect("settings serialise");
    let c = canonical(&value).map_err(HashError::Canonical)?;
    Ok(sha256_hex(&(c + salt)))
}

pub fn normalize_owner(owner: &str) -> Result<String, HashError> {
    if is_address(owner) {
        return Ok(owner.to_ascii_lowercase());
    }
    if let Some(key) = owner.strip_prefix("ed25519:") {
        let base58 = |b: u8| b.is_ascii_alphanumeric() && !matches!(b, b'0' | b'O' | b'I' | b'l');
        if (32..=44).contains(&key.len()) && key.bytes().all(base58) {
            return Ok(owner.to_string());
        }
    }
    Err(HashError::Owner)
}

/// sha256 of the owner's signature over "ripcord:owner-salt:v1".
pub fn owner_salt(signature_hex: &str) -> Result<String, HashError> {
    let sig = signature_hex.strip_prefix("0x").unwrap_or(signature_hex);
    let bytes = hex::decode(sig).map_err(|_| HashError::Signature)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

pub fn owner_commitment(owner: &str, salt: &str) -> Result<String, HashError> {
    need_salt(salt)?;
    Ok(sha256_hex(&(normalize_owner(owner)? + salt)))
}

pub fn account_commitment(hl_address: &str, salt: &str) -> Result<String, HashError> {
    need_salt(salt)?;
    if !is_address(hl_address) {
        return Err(HashError::Address);
    }
    Ok(sha256_hex(&(hl_address.to_ascii_lowercase() + salt)))
}

/// As printed on the card: first 4 bytes and last 2 bytes of the commitment.
pub fn fingerprint(c: &str) -> String {
    let u = c.to_ascii_uppercase();
    format!("{} {} ···· {}", &u[0..4], &u[4..8], &u[u.len() - 4..])
}

/// As printed on the ledger.
pub fn fingerprint_short(c: &str) -> String {
    let u = c.to_ascii_uppercase();
    format!("{} ···· {}", &u[0..4], &u[u.len() - 4..])
}

/// "g-" + 10 base32 characters of 50 bits.
pub fn guard_id_from_bits(bits: u64) -> Option<String> {
    if bits >= 1 << 50 {
        return None;
    }
    let s: String = (0..10)
        .map(|i| BASE32[((bits >> (5 * (9 - i))) & 31) as usize] as char)
        .collect();
    Some(format!("g-{s}"))
}

pub fn is_guard_id(s: &str) -> bool {
    s.len() == 12
        && s.starts_with("g-")
        && s[2..]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || (b'2'..=b'7').contains(&b))
}
