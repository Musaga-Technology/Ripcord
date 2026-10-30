//! Sealed records: values encrypted under the project's `vault` encryption key, bound to their storage key as
//! associated data, then kept as raw records. The storage operator sees only key names and ciphertext.
use crate::host::Host;
use serde::{de::DeserializeOwned, Serialize};

const VAULT: &str = "vault";

pub fn put<T: Serialize>(host: &dyn Host, key: &str, value: &T) -> Result<(), String> {
    let plain = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let sealed = host.encrypt(VAULT, &plain, key.as_bytes())?;
    host.set_raw(key, &sealed)
}

pub fn get<T: DeserializeOwned>(host: &dyn Host, key: &str) -> Result<Option<T>, String> {
    match host.get_raw(key)? {
        None => Ok(None),
        Some(sealed) => {
            let plain = host.decrypt(VAULT, &sealed, key.as_bytes())?;
            serde_json::from_slice(&plain).map(Some).map_err(|e| e.to_string())
        }
    }
}

/// The enclave's X25519 secret for opening settings: a keyed hash under the `seal` encryption key, so it is
/// derived again on every run, never stored, and only this project's code in the TEE can compute it.
pub fn seal_secret(host: &dyn Host) -> Result<[u8; 32], String> {
    let m = host.mac("seal", b"ripcord:ecies:v1")?;
    m.try_into().map_err(|_| "mac is not 32 bytes".to_string())
}
