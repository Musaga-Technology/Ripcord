//! The enclave binary: OutLayer's interfaces behind the checker's [`Host`] trait. Input is JSON on stdin, output
//! is JSON on stdout, at most 900 bytes. Everything else lives in the library and is tested natively.
use ripcord_checker::actions::{refuse, run};
use ripcord_checker::host::Host;
use std::io::{Read, Write};
use std::time::Duration;

mod bindings {
    wit_bindgen::generate!({ world: "checker", path: "wit", generate_all });
}
use bindings::near::storage::api as storage;
use bindings::outlayer::encryption_keys::api as encryption_keys;
use bindings::outlayer::signing_keys::api as signing_keys;

// The manifest, in the `outlayer.manifest` custom section: covered by the wasm's sha256, so the keys, network
// allowlist and caller rules are part of the attested code.
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");

const MAX_OUTPUT: usize = 900;

struct OutLayer;

/// A storage function answers its error as a string, empty on success.
fn ok(error: String) -> Result<(), String> {
    if error.is_empty() {
        Ok(())
    } else {
        Err(error)
    }
}

impl Host for OutLayer {
    fn mac(&self, path: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        encryption_keys::mac(path, None, data)
    }

    fn encrypt(&self, path: &str, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
        encryption_keys::encrypt(path, None, plaintext, aad)
    }

    fn decrypt(&self, path: &str, ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
        encryption_keys::decrypt(path, None, ciphertext, aad)
    }

    /// A ciphertext is never empty, so an empty value is no record.
    fn get_raw(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let (value, error) = storage::get_raw(key);
        ok(error)?;
        Ok((!value.is_empty()).then_some(value))
    }

    fn set_raw(&self, key: &str, value: &[u8]) -> Result<(), String> {
        ok(storage::set_raw(key, value))
    }

    fn public_key(&self, path: &str) -> Result<[u8; 32], String> {
        signing_keys::public_key(path, None)?
            .try_into()
            .map_err(|_| "public key is not 32 bytes".into())
    }

    fn sign(&self, path: &str, message: &[u8]) -> Result<[u8; 64], String> {
        signing_keys::sign(path, None, message)?
            .try_into()
            .map_err(|_| "signature is not 64 bytes".into())
    }

    fn http(
        &self,
        method: &str,
        url: &str,
        headers: &[(&str, String)],
        body: Option<&[u8]>,
    ) -> Result<(u16, Vec<u8>), String> {
        let client = wasi_http_client::Client::new();
        let mut rb = match method {
            "GET" => client.get(url),
            "POST" => client.post(url),
            _ => return Err(format!("unsupported method {method}")),
        };
        rb = rb
            .header("User-Agent", "ripcord-checker/0.1")
            .connect_timeout(Duration::from_secs(5));
        for (k, v) in headers {
            rb = rb.header(*k, v.clone());
        }
        if let Some(b) = body {
            rb = rb.body(b);
        }
        let resp = rb.send().map_err(|e| format!("send: {e}"))?;
        let status = resp.status();
        Ok((status, resp.body().map_err(|e| format!("body: {e}"))?))
    }

    fn random(&self, n: usize) -> Vec<u8> {
        wasi::random::random::get_random_bytes(n as u64)
    }

    fn now_ms(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64)
    }
}

fn main() {
    let mut input = String::new();
    let out = match std::io::stdin().read_to_string(&mut input) {
        Ok(_) => run(&OutLayer, &input),
        Err(_) => refuse("input is not UTF-8"),
    };
    let mut text = out.to_string();
    if text.len() > MAX_OUTPUT {
        text = refuse("output too long").to_string();
    }
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(text.as_bytes());
    let _ = stdout.flush();
}
