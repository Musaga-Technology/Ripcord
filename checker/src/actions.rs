//! The checker's actions (docs/SPEC.md §3). Input is JSON on stdin, output is JSON on stdout (≤ 900 bytes) and
//! carries a status, never a setting. Refusal reasons name the rule that failed, never the value.
use crate::host::Host;
use crate::{policy, settings, vault};
use ripcord_rules::commitment::{account_commitment, commitment, is_guard_id, owner_commitment};
use ripcord_rules::seal;
use ripcord_rules::types::GuardSettings;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The signing key that is the checker's NEAR account (an implicit account: its public key in hex).
pub const CHECKER_KEY: &str = "checker";

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Input {
    Pubkey,
    Create(CreateInput),
}

#[derive(Deserialize)]
pub struct CreateInput {
    pub guard_id: String,
    pub commitment: String,
    pub owner_commitment: String,
    pub account_commitment: String,
    pub expires_at: String,
    /// The sealed payload, hex: version ‖ ephemeral key ‖ nonce ‖ ciphertext (see `ripcord_rules::seal`).
    pub enc_settings: String,
}

/// What the owner's device seals: the settings and the salts their commitments use.
#[derive(Serialize, Deserialize, Clone)]
pub struct SealedPayload {
    pub settings: GuardSettings,
    pub salt: String,
    pub owner_salt: String,
}

/// Kept in the vault under `s/<guard_id>`.
#[derive(Serialize, Deserialize, Clone)]
pub struct StoredGuard {
    pub settings: GuardSettings,
    pub salt: String,
    pub commitment: String,
}

pub fn refuse(reason: &str) -> Value {
    json!({ "status": "skipped", "refused": reason })
}

pub fn run(host: &dyn Host, input: &str) -> Value {
    match serde_json::from_str::<Input>(input) {
        Err(_) => refuse("input is not a known action"),
        Ok(Input::Pubkey) => pubkey(host).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Create(c)) => create(host, &c).unwrap_or_else(|e| refuse(&e)),
    }
}

pub fn pubkey(host: &dyn Host) -> Result<Value, String> {
    let enc_pk = seal::public_key(&vault::seal_secret(host)?);
    let account = hex::encode(host.public_key(CHECKER_KEY)?);
    Ok(json!({ "enc_pk": hex::encode(enc_pk), "account": account }))
}

/// Opens the owner's sealed settings, checks them against the three public hashes, and seals them in the vault.
pub fn create(host: &dyn Host, c: &CreateInput) -> Result<Value, String> {
    if !is_guard_id(&c.guard_id) {
        return Err("invalid guard_id".into());
    }
    let envelope = hex::decode(&c.enc_settings).map_err(|_| "enc_settings must be hex")?;
    let plain = seal::open(&vault::seal_secret(host)?, &envelope, &c.guard_id)
        .map_err(|_| "enc_settings does not open for this guard")?;
    let p: SealedPayload = serde_json::from_slice(&plain).map_err(|_| "sealed settings are malformed")?;

    let ok = commitment(&p.settings, &p.salt).is_ok_and(|x| x == c.commitment)
        && owner_commitment(&p.settings.owner, &p.owner_salt).is_ok_and(|x| x == c.owner_commitment)
        && account_commitment(&p.settings.hl_address, &p.settings.account_salt)
            .is_ok_and(|x| x == c.account_commitment)
        && p.settings.expires_at == c.expires_at;
    if !ok {
        return Err("settings do not match the public commitments".into());
    }
    settings::validate(&p.settings, host.now_ms())?;

    let key = format!("s/{}", c.guard_id);
    if let Some(existing) = vault::get::<StoredGuard>(host, &key)? {
        if existing.commitment != c.commitment {
            return Err("guard_id already holds other settings".into());
        }
        return Ok(json!({ "status": "pending" }));
    }
    vault::put(
        host,
        &key,
        &StoredGuard {
            settings: p.settings,
            salt: p.salt,
            commitment: c.commitment.clone(),
        },
    )?;
    Ok(json!({ "status": "pending" }))
}

/// The wallet policy for a stored guard (used by `create` once its custody wallet is open).
pub fn policy_for(
    host: &dyn Host,
    guard_id: &str,
    fee_wallet: &str,
    reserve: Option<policy::ReserveUnits>,
) -> Result<Value, String> {
    let g: StoredGuard = vault::get(host, &format!("s/{guard_id}"))?.ok_or("no such guard")?;
    policy::build(&g.settings, fee_wallet, reserve).map_err(String::from)
}
