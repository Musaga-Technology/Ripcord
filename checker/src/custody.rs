//! A guard's own custody wallet on OutLayer, opened by the checker's enclave key (docs/SPEC.md §3). Deterministic
//! wallets: `wallet_id = f(checker account, seed = guard id)`, so only this code can ever open a guard's wallet.
//! Formats from OutLayer's agent-custody skill (references/register-and-auth.md, confidential.md), Oct 30 2026.
use crate::actions::CHECKER_KEY;
use crate::host::Host;
use crate::near_tx::bs58_encode;
use base64::Engine;
use serde_json::{json, Value};

pub struct Custody<'a> {
    host: &'a dyn Host,
    api: &'a str,
    account: String,
    pubkey: String,
}

impl<'a> Custody<'a> {
    pub fn new(host: &'a dyn Host, api: &'a str) -> Result<Self, String> {
        let pk = host.public_key(CHECKER_KEY)?;
        Ok(Self {
            host,
            api,
            account: hex::encode(pk),
            pubkey: format!("ed25519:{}", bs58_encode(&pk)),
        })
    }

    fn sign(&self, message: &str) -> Result<String, String> {
        Ok(bs58_encode(&self.host.sign(CHECKER_KEY, message.as_bytes())?))
    }

    fn now_s(&self) -> u64 {
        self.host.now_ms() / 1000
    }

    /// `Bearer near:` token: base64url (no padding) of the account, seed, key, time and a signature of
    /// "auth:<seed>:<time>" (OutLayer accepts ±30 s).
    pub fn token(&self, seed: &str) -> Result<String, String> {
        let ts = self.now_s();
        let body = json!({
            "account_id": self.account, "seed": seed, "pubkey": self.pubkey, "timestamp": ts,
            "signature": self.sign(&format!("auth:{seed}:{ts}"))?,
        });
        Ok(format!(
            "near:{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(body.to_string())
        ))
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        auth: Option<&str>,
        body: Option<&Value>,
        idem: Option<&str>,
    ) -> Result<(u16, Value), String> {
        let mut headers = vec![("Content-Type", "application/json".to_string())];
        if let Some(t) = auth {
            headers.push(("Authorization", format!("Bearer {t}")));
        }
        if let Some(k) = idem {
            headers.push(("X-Idempotency-Key", k.to_string()));
        }
        let bytes = body.map(|b| b.to_string().into_bytes());
        let (code, raw) = self
            .host
            .http(method, &format!("{}{path}", self.api), &headers, bytes.as_deref())?;
        Ok((code, serde_json::from_slice(&raw).unwrap_or(Value::Null)))
    }

    fn ok(&self, what: &str, (code, v): (u16, Value)) -> Result<Value, String> {
        if (200..300).contains(&code) {
            Ok(v)
        } else {
            // Only the status: an upstream message could echo an address or an amount.
            Err(format!("{what}: HTTP {code}"))
        }
    }

    /// Opens (or reopens: the same seed always gives the same wallet) the guard's wallet.
    pub fn register(&self, seed: &str) -> Result<String, String> {
        let message = format!("register:{seed}:{}", self.now_s());
        let body = json!({
            "account_id": self.account, "seed": seed, "pubkey": self.pubkey,
            "message": message, "signature": self.sign(&message)?,
        });
        let v = self.ok("register", self.request("POST", "/register", None, Some(&body), None)?)?;
        v["wallet_id"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| "register: no wallet_id".into())
    }

    /// OutLayer encrypts the policy for its keystore; returns the ciphertext the registry stores on chain.
    pub fn encrypt_policy(&self, seed: &str, wallet_id: &str, policy: &Value) -> Result<String, String> {
        let mut body = policy.clone();
        body["wallet_id"] = json!(wallet_id);
        let t = self.token(seed)?;
        let v = self.ok(
            "encrypt-policy",
            self.request("POST", "/wallet/v1/encrypt-policy", Some(&t), Some(&body), None)?,
        )?;
        v["encrypted_base64"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| "encrypt-policy: no ciphertext".into())
    }

    /// The wallet signs the encrypted policy for `caller` (the registry), so only the registry can store it.
    /// Returns (signature hex, wallet public key hex).
    pub fn sign_policy(&self, seed: &str, encrypted: &str, caller: &str) -> Result<(String, String), String> {
        let t = self.token(seed)?;
        let body = json!({ "encrypted_data": encrypted, "caller": caller });
        let v = self.ok(
            "sign-policy",
            self.request("POST", "/wallet/v1/sign-policy", Some(&t), Some(&body), None)?,
        )?;
        match (v["signature_hex"].as_str(), v["public_key_hex"].as_str()) {
            (Some(s), Some(p)) => Ok((s.into(), p.into())),
            _ => Err("sign-policy: incomplete answer".into()),
        }
    }

    /// A one-time address that credits the guard's confidential balance from another chain.
    pub fn deposit_address(&self, seed: &str, source_asset: &str, amount: &str) -> Result<String, String> {
        let t = self.token(seed)?;
        let body = json!({ "source_asset": source_asset, "amount": amount });
        let idem = format!("{seed}-fund-{source_asset}-{amount}");
        let path = "/wallet/v1/confidential/deposit/cross-chain";
        let v = self.ok(
            "deposit",
            self.request("POST", path, Some(&t), Some(&body), Some(&idem))?,
        )?;
        v["deposit_address"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| "deposit: no address".into())
    }
}
