//! Everything the checker needs from OutLayer, behind one trait: sealed storage, encryption keys, the signing key,
//! HTTPS, randomness and time. The enclave build implements it with OutLayer's WIT interfaces (`src/main.rs`,
//! feature `outlayer`); tests and `run-local.sh` use [`MockHost`].
use std::cell::RefCell;
use std::collections::HashMap;

pub trait Host {
    /// HMAC-SHA256 under the project's encryption key `path` (deterministic; the key never leaves the keystore).
    fn mac(&self, path: &str, data: &[u8]) -> Result<Vec<u8>, String>;
    fn encrypt(&self, path: &str, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String>;
    fn decrypt(&self, path: &str, ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String>;
    /// Raw storage: the operator can read key names and values, so values are sealed first (see `vault`).
    fn get_raw(&self, key: &str) -> Result<Option<Vec<u8>>, String>;
    fn set_raw(&self, key: &str, value: &[u8]) -> Result<(), String>;
    /// The checker's ed25519 signing key (`path`), derived in the keystore for this project.
    fn public_key(&self, path: &str) -> Result<[u8; 32], String>;
    /// Signs bytes this module composed itself; never caller-supplied bytes (OutLayer signing-keys rules).
    fn sign(&self, path: &str, message: &[u8]) -> Result<[u8; 64], String>;
    fn http(
        &self,
        method: &str,
        url: &str,
        headers: &[(&str, String)],
        body: Option<&[u8]>,
    ) -> Result<(u16, Vec<u8>), String>;
    fn random(&self, n: usize) -> Vec<u8>;
    fn now_ms(&self) -> u64;
}

/// A request as the mock host saw it: its url and headers.
pub type Sent = (String, Vec<(String, String)>);

/// An in-memory host for tests: deterministic keys from a seed, a scripted HTTP responder, a fixed clock.
pub struct MockHost {
    pub seed: [u8; 32],
    pub storage: RefCell<HashMap<String, Vec<u8>>>,
    pub now_ms: u64,
    pub calls: RefCell<Vec<String>>,
    /// Each request's (url, headers), so tests can see idempotency keys.
    pub headers: RefCell<Vec<Sent>>,
    #[allow(clippy::type_complexity)]
    pub responder: Box<dyn Fn(&str, &str, Option<&[u8]>) -> (u16, Vec<u8>)>,
}

impl MockHost {
    pub fn new(seed: u8) -> Self {
        Self {
            seed: [seed; 32],
            storage: RefCell::new(HashMap::new()),
            now_ms: 1_793_541_381_000,
            calls: RefCell::new(Vec::new()),
            headers: RefCell::new(Vec::new()),
            responder: Box::new(|_, _, _| (404, b"{}".to_vec())),
        }
    }

    fn derive(&self, label: &str, data: &[u8]) -> [u8; 32] {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(self.seed);
        h.update(label.as_bytes());
        h.update([0]);
        h.update(data);
        h.finalize().into()
    }

    fn stream(&self, path: &str, aad: &[u8], len: usize) -> Vec<u8> {
        (0..len.div_ceil(32))
            .flat_map(|i| self.derive(&format!("enc:{path}:{i}"), aad))
            .take(len)
            .collect()
    }
}

impl Host for MockHost {
    fn mac(&self, path: &str, data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(self.derive(&format!("mac:{path}"), data).to_vec())
    }

    // A toy AEAD for tests only: XOR stream plus a 32-byte tag, enough to prove sealing round-trips and that a
    // record sealed under one aad does not open under another. The enclave uses OutLayer's real keys.
    fn encrypt(&self, path: &str, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
        let mut out: Vec<u8> = plaintext
            .iter()
            .zip(self.stream(path, aad, plaintext.len()))
            .map(|(p, k)| p ^ k)
            .collect();
        out.extend_from_slice(&self.derive(&format!("tag:{path}"), &[aad, plaintext].concat()));
        Ok(out)
    }

    fn decrypt(&self, path: &str, ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() < 32 {
            return Err("decryption failed".into());
        }
        let (body, tag) = ciphertext.split_at(ciphertext.len() - 32);
        let pt: Vec<u8> = body
            .iter()
            .zip(self.stream(path, aad, body.len()))
            .map(|(c, k)| c ^ k)
            .collect();
        if self.derive(&format!("tag:{path}"), &[aad, &pt].concat()) != tag {
            return Err("decryption failed".into());
        }
        Ok(pt)
    }

    fn get_raw(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(self.storage.borrow().get(key).cloned())
    }

    fn set_raw(&self, key: &str, value: &[u8]) -> Result<(), String> {
        self.storage.borrow_mut().insert(key.into(), value.to_vec());
        Ok(())
    }

    fn public_key(&self, path: &str) -> Result<[u8; 32], String> {
        Ok(self.derive(&format!("pk:{path}"), &[]))
    }

    fn sign(&self, path: &str, message: &[u8]) -> Result<[u8; 64], String> {
        let a = self.derive(&format!("sig:{path}"), message);
        let mut s = [0u8; 64];
        s[..32].copy_from_slice(&a);
        s[32..].copy_from_slice(&a);
        Ok(s)
    }

    fn http(
        &self,
        method: &str,
        url: &str,
        headers: &[(&str, String)],
        body: Option<&[u8]>,
    ) -> Result<(u16, Vec<u8>), String> {
        self.calls.borrow_mut().push(format!("{method} {url}"));
        let h = headers.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
        self.headers.borrow_mut().push((url.to_string(), h));
        Ok((self.responder)(method, url, body))
    }

    fn random(&self, n: usize) -> Vec<u8> {
        let c = self.calls.borrow().len();
        (0..n.div_ceil(32))
            .flat_map(|i| self.derive(&format!("rand:{c}:{i}"), &[]))
            .take(n)
            .collect()
    }

    fn now_ms(&self) -> u64 {
        self.now_ms
    }
}
