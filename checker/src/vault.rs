//! Sealed records: values encrypted under the project's `vault` encryption key, bound to their name as associated
//! data, and kept as raw records under a MAC of the name. The storage operator sees neither names nor values.
use crate::host::Host;
use serde::{de::DeserializeOwned, Serialize};

const VAULT: &str = "vault";

/// Where the record `name` is stored: `v/` + hex of its MAC, the same in every run.
pub fn raw_key(host: &dyn Host, name: &str) -> Result<String, String> {
    Ok(format!("v/{}", hex::encode(host.mac(VAULT, name.as_bytes())?)))
}

pub fn put<T: Serialize>(host: &dyn Host, name: &str, value: &T) -> Result<(), String> {
    let plain = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let sealed = host.encrypt(VAULT, &plain, name.as_bytes())?;
    host.set_raw(&raw_key(host, name)?, &sealed)
}

pub fn get<T: DeserializeOwned>(host: &dyn Host, name: &str) -> Result<Option<T>, String> {
    match host.get_raw(&raw_key(host, name)?)? {
        None => Ok(None),
        Some(sealed) => {
            let plain = host.decrypt(VAULT, &sealed, name.as_bytes())?;
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
