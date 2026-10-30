//! Sealing guard settings to the checker's enclave key: X25519, HKDF-SHA256, ChaCha20-Poly1305, with the guard
//! id as associated data. Mirrors `packages/shared/src/seal.ts`; `vectors/seal.json` keeps them byte-for-byte equal.
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

pub const SEAL_INFO: &str = "ripcord:seal:v1";
const VERSION: u8 = 1;
const HEADER: usize = 1 + 32 + 12;

#[derive(Debug, PartialEq, Eq)]
pub enum SealError {
    /// Too short or an unknown version byte.
    Format,
    /// Altered, or sealed for another key or another guard. Which one is not said.
    Open,
}

fn key(shared: &[u8; 32], eph: &[u8; 32], recipient: &[u8; 32]) -> [u8; 32] {
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(eph);
    salt[32..].copy_from_slice(recipient);
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared)
        .expand(SEAL_INFO.as_bytes(), &mut out)
        .expect("32 bytes is a valid HKDF length");
    out
}

fn aad(guard_id: &str) -> Vec<u8> {
    format!("{SEAL_INFO}:{guard_id}").into_bytes()
}

pub fn public_key(secret: &[u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(*secret)).to_bytes()
}

/// Envelope: version ‖ ephemeral public key (32) ‖ nonce (12) ‖ ciphertext with tag. Deterministic given its inputs.
pub fn seal_with(
    eph_secret: &[u8; 32],
    nonce: &[u8; 12],
    recipient: &[u8; 32],
    plaintext: &[u8],
    guard_id: &str,
) -> Vec<u8> {
    let eph = StaticSecret::from(*eph_secret);
    let eph_pk = PublicKey::from(&eph).to_bytes();
    let shared = eph.diffie_hellman(&PublicKey::from(*recipient)).to_bytes();
    let k = key(&shared, &eph_pk, recipient);
    let ct = ChaCha20Poly1305::new(&Key::from(k))
        .encrypt(
            &Nonce::from(*nonce),
            Payload {
                msg: plaintext,
                aad: &aad(guard_id),
            },
        )
        .expect("ChaCha20-Poly1305 encryption does not fail on in-memory input");
    let mut out = Vec::with_capacity(HEADER + ct.len());
    out.push(VERSION);
    out.extend_from_slice(&eph_pk);
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    out
}

/// Opens an envelope with the recipient's secret.
pub fn open(recipient_secret: &[u8; 32], envelope: &[u8], guard_id: &str) -> Result<Vec<u8>, SealError> {
    if envelope.len() < HEADER + 16 || envelope[0] != VERSION {
        return Err(SealError::Format);
    }
    let eph: [u8; 32] = envelope[1..33].try_into().expect("32 bytes");
    let secret = StaticSecret::from(*recipient_secret);
    let recipient = PublicKey::from(&secret).to_bytes();
    let shared = secret.diffie_hellman(&PublicKey::from(eph)).to_bytes();
    let k = key(&shared, &eph, &recipient);
    let nonce: [u8; 12] = envelope[33..45].try_into().expect("12 bytes");
    ChaCha20Poly1305::new(&Key::from(k))
        .decrypt(
            &Nonce::from(nonce),
            Payload {
                msg: &envelope[HEADER..],
                aad: &aad(guard_id),
            },
        )
        .map_err(|_| SealError::Open)
}
