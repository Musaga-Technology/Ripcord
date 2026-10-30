//! Owner signatures (docs/SPEC.md §2 "Signatures"). An owner is an EVM address that signs EIP-191, or an
//! ed25519 public key (`ed25519:<base58>`) that signs NEP-413 for this registry account.
use near_sdk::env;

/// NEP-413 tag: 2^31 + 413, borsh-encoded first so a signed message can't be replayed as a transaction.
const NEP413_TAG: u32 = 2_147_484_061;

pub fn verify(owner: &str, message: &str, nonce: &str, signature_hex: &str, recipient: &str) -> bool {
    let Ok(sig) = hex::decode(signature_hex.trim_start_matches("0x")) else {
        return false;
    };
    match owner.strip_prefix("ed25519:") {
        Some(key) => verify_nep413(key, message, nonce, &sig, recipient),
        None => verify_eip191(owner, message, &sig),
    }
}

fn verify_nep413(key_b58: &str, message: &str, nonce: &str, sig: &[u8], recipient: &str) -> bool {
    let Some(pk) = bs58::decode(key_b58)
        .into_vec()
        .ok()
        .and_then(|v| <[u8; 32]>::try_from(v).ok())
    else {
        return false;
    };
    let Ok(sig) = <[u8; 64]>::try_from(sig) else {
        return false;
    };
    // NEP-413 nonces are 32 bytes; ours is a short string, so the signed nonce is its sha256.
    let hash = nep413_hash(message, &env::sha256_array(nonce.as_bytes()), recipient);
    env::ed25519_verify(&sig, hash, &pk)
}

/// sha256(borsh(tag) ‖ borsh(Payload { message, nonce, recipient, callback_url: None })).
pub fn nep413_hash(message: &str, nonce: &[u8; 32], recipient: &str) -> [u8; 32] {
    let mut b = Vec::with_capacity(4 + 4 + message.len() + 32 + 4 + recipient.len() + 1);
    b.extend_from_slice(&NEP413_TAG.to_le_bytes());
    b.extend_from_slice(&(message.len() as u32).to_le_bytes());
    b.extend_from_slice(message.as_bytes());
    b.extend_from_slice(nonce);
    b.extend_from_slice(&(recipient.len() as u32).to_le_bytes());
    b.extend_from_slice(recipient.as_bytes());
    b.push(0);
    env::sha256_array(&b)
}

fn verify_eip191(owner: &str, message: &str, sig: &[u8]) -> bool {
    if sig.len() != 65 || !is_address(owner) {
        return false;
    }
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
    let hash = env::keccak256_array(prefixed.as_bytes());
    let v = if sig[64] >= 27 { sig[64] - 27 } else { sig[64] };
    let Some(pubkey) = env::ecrecover(&hash, &sig[..64], v, true) else {
        return false;
    };
    let address = &env::keccak256_array(pubkey)[12..];
    hex::encode(address) == owner[2..].to_ascii_lowercase()
}

fn is_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}
