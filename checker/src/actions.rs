//! The checker's actions (docs/SPEC.md §3). Input is JSON on stdin, output is JSON on stdout (≤ 900 bytes) and
//! carries a status, never a setting. Refusal reasons name the rule that failed, never the value.
use crate::change::{self, ResealInput, TopupInput};
use crate::check::{self, seal_to_owner};
use crate::close::{self, CloseInput};
use crate::config::{NET, OWNER_GAS, REGISTER_DEPOSIT, REGISTER_GAS};
use crate::custody::Custody;
use crate::host::Host;
use crate::{oneclick, policy, registry, settings, vault};
use ripcord_rules::commitment::{account_commitment, commitment, is_guard_id, owner_commitment};
use ripcord_rules::seal;
use ripcord_rules::types::{CheckStatus, GuardSettings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The signing key that is the checker's NEAR account (an implicit account: its public key in hex).
pub const CHECKER_KEY: &str = "checker";

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Input {
    Pubkey,
    Create(CreateInput),
    Fund(FundInput),
    Reserve { guard_id: String },
    Check { guard_id: String },
    Freeze(FreezeInput),
    Close(CloseInput),
    Topup(TopupInput),
    Reseal(ResealInput),
}

/// An owner's freeze or unfreeze, signed with the owner key; the enclave only submits it and pays the gas, and the
/// registry checks the signature.
#[derive(Deserialize)]
pub struct FreezeInput {
    pub guard_id: String,
    pub owner: String,
    pub owner_salt: String,
    pub sig: String,
    pub nonce: String,
    pub frozen: bool,
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

#[derive(Deserialize)]
pub struct FundInput {
    pub guard_id: String,
    /// The 1Click asset the owner sends from (e.g. USDC on Arbitrum); the amount is the sealed budget.
    pub source_asset: String,
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
    /// The other two public hashes, for registering the guard once its reserve arrives.
    #[serde(default)]
    pub owner_commitment: String,
    #[serde(default)]
    pub account_commitment: String,
    /// The guard's custody wallet is open (off chain).
    #[serde(default)]
    pub wallet_open: bool,
    /// The `register_guard` transaction, once the guard's wallet policy is on chain.
    #[serde(default)]
    pub registered: Option<String>,
    /// What the owner's top-ups added to the sealed budget, and the nonces they were signed with.
    #[serde(default)]
    pub added_usd: f64,
    #[serde(default)]
    pub topups: Vec<String>,
}

pub fn refuse(reason: &str) -> Value {
    json!({ "status": "skipped", "refused": reason })
}

pub fn run(host: &dyn Host, input: &str) -> Value {
    match serde_json::from_str::<Input>(input) {
        Err(_) => refuse("input is not a known action"),
        Ok(Input::Pubkey) => pubkey(host).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Create(c)) => create(host, &c).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Fund(f)) => fund(host, &f).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Reserve { guard_id }) => reserve(host, &guard_id).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Freeze(f)) => freeze(host, &f).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Close(c)) => close::close(host, &c).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Topup(t)) => change::topup(host, &t).unwrap_or_else(|e| refuse(&e)),
        Ok(Input::Reseal(r)) => change::reseal(host, &r).unwrap_or_else(|e| refuse(&e)),
        // A check answers with its status alone, even when it fails (rule 4).
        Ok(Input::Check { guard_id }) => {
            json!({ "status": check::check(host, &guard_id).unwrap_or(CheckStatus::Skipped) })
        }
    }
}

/// Submits an owner's signed freeze or unfreeze to the registry, which freezes the guard's wallet on OutLayer.
pub fn freeze(host: &dyn Host, f: &FreezeInput) -> Result<Value, String> {
    if !is_guard_id(&f.guard_id) {
        return Err("invalid guard_id".into());
    }
    let method = if f.frozen { "freeze_guard" } else { "unfreeze_guard" };
    let args = json!({
        "guard_id": f.guard_id, "owner": f.owner, "owner_salt": f.owner_salt, "sig": f.sig, "nonce": f.nonce,
    });
    registry::call(host, method, &args, OWNER_GAS, 0)?;
    Ok(json!({ "status": if f.frozen { "frozen" } else { "guarding" } }))
}

pub fn pubkey(host: &dyn Host) -> Result<Value, String> {
    let enc_pk = seal::public_key(&vault::seal_secret(host)?);
    let account = hex::encode(host.public_key(CHECKER_KEY)?);
    Ok(json!({ "enc_pk": hex::encode(enc_pk), "account": account }))
}

/// Opens the owner's sealed settings, checks them against the three public hashes, seals them in the vault and opens
/// the guard's custody wallet. Nothing goes on chain yet: a guard is registered, with its wallet's policy, once its
/// reserve arrives (`activate`), so a guard nobody funds costs nothing on NEAR. Safe to retry with the same input.
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
    let mut g = match vault::get::<StoredGuard>(host, &key)? {
        Some(existing) if existing.commitment != c.commitment => {
            return Err("guard_id already holds other settings".into())
        }
        Some(existing) => existing,
        None => {
            let g = StoredGuard {
                settings: p.settings,
                salt: p.salt,
                commitment: c.commitment.clone(),
                owner_commitment: c.owner_commitment.clone(),
                account_commitment: c.account_commitment.clone(),
                wallet_open: false,
                registered: None,
                added_usd: 0.0,
                topups: vec![],
            };
            vault::put(host, &key, &g)?;
            g
        }
    };
    if !g.wallet_open {
        Custody::new(host, NET.outlayer_api)?.register(&c.guard_id)?;
        g.wallet_open = true;
        vault::put(host, &key, &g)?;
    }
    // An isolated guard's owner approves this wallet's EVM address on Hyperliquid. Sealed: an approved agent's
    // address names the account it serves, so a guard id must not lead to it.
    if g.settings.isolated.is_some() {
        let agent = Custody::new(host, NET.outlayer_api)?.evm_address(&c.guard_id)?;
        let sealed = seal_to_owner(host, &c.guard_id, &g, &json!({ "agent": agent }))?;
        return Ok(json!({ "status": "pending", "sealed": sealed }));
    }
    Ok(json!({ "status": "pending" }))
}

/// Puts a funded guard on chain: its wallet's policy encrypted by OutLayer and signed by the wallet for the registry,
/// and `register_guard` signed by the checker's own key. Until then only this code can move the wallet's money, and it
/// pays only the owner's account. Idempotent: a guard already on chain is only marked.
pub fn activate(host: &dyn Host, guard_id: &str, mut g: StoredGuard) -> Result<StoredGuard, String> {
    if g.registered.is_none() {
        g.registered = Some(register(host, guard_id, &g)?);
        vault::put(host, &format!("s/{guard_id}"), &g)?;
    }
    Ok(g)
}

/// A non-USDC reserve's price, for its per-transaction cap in the wallet's policy.
pub fn reserve_units(host: &dyn Host, s: &GuardSettings) -> Result<Option<policy::ReserveUnits>, String> {
    if s.reserve_asset == policy::USDC {
        return Ok(None);
    }
    let t = oneclick::token(host, NET.oneclick, &s.reserve_asset)?;
    Ok(Some(policy::ReserveUnits { per_usd: t.per_usd() }))
}

/// True when any balance in the guard's wallet is above zero.
pub fn funded(balances: &[(String, String)]) -> bool {
    balances.iter().any(|(_, b)| b.parse::<u128>().is_ok_and(|x| x > 0))
}

fn register(host: &dyn Host, guard_id: &str, g: &StoredGuard) -> Result<String, String> {
    let on_chain = registry::view(host, "get_guard", &json!({ "guard_id": guard_id }))?;
    if !on_chain.is_null() {
        return Ok("already registered".into());
    }
    let s = &g.settings;
    let custody = Custody::new(host, NET.outlayer_api)?;
    let wallet_id = custody.register(guard_id)?;
    let p = policy::build(s, NET.fee_wallet, reserve_units(host, s)?)?;
    let encrypted = custody.encrypt_policy(guard_id, &wallet_id, &p)?;
    let signed = custody.sign_policy(guard_id, &encrypted, NET.registry)?;
    let args = json!({
        "guard_id": guard_id,
        "commitment": g.commitment,
        "owner_commitment": g.owner_commitment,
        "account_commitment": g.account_commitment,
        "expires_at": s.expires_at,
        "wallet_pubkey": format!("ed25519:{}", signed.public_key),
        "encrypted_policy": encrypted,
        "wallet_signature": signed.signature,
        "policy_version": signed.version,
        "policy_valid_until": signed.valid_until,
    });
    registry::call(host, "register_guard", &args, REGISTER_GAS, REGISTER_DEPOSIT)
}

/// A one-time address on the owner's chain that funds the guard's confidential reserve with its budget. The amount
/// comes from the sealed settings, never from input. The address and amount are sealed to the owner: guard ids are
/// public, and whoever holds the address can read the reserve's size on its chain.
pub fn fund(host: &dyn Host, f: &FundInput) -> Result<Value, String> {
    let g: StoredGuard = vault::get(host, &format!("s/{}", f.guard_id))?.ok_or("no such guard")?;
    if !g.wallet_open {
        return Err("guard's wallet is not open yet".into());
    }
    let t = oneclick::token(host, NET.oneclick, &f.source_asset)?;
    let amount = ((g.settings.budget_usd * t.per_usd()).ceil() as u128).to_string();
    let custody = Custody::new(host, NET.outlayer_api)?;
    let address = custody.deposit_address(&f.guard_id, &f.source_asset, &amount, "fund")?;
    let sealed = seal_to_owner(
        host,
        &f.guard_id,
        &g,
        &json!({ "deposit_address": address, "amount": amount, "decimals": t.decimals }),
    )?;
    Ok(json!({ "status": "pending", "sealed": sealed }))
}

/// The reserve's balances, sealed to the owner: a stranger's call learns nothing, not even whether it is funded.
pub fn reserve(host: &dyn Host, guard_id: &str) -> Result<Value, String> {
    let g: StoredGuard = vault::get(host, &format!("s/{guard_id}"))?.ok_or("no such guard")?;
    let custody = Custody::new(host, NET.outlayer_api)?;
    let Some(list) = custody.balances(guard_id)? else {
        return Err("the private route is unavailable".into());
    };
    let g = if funded(&list) { activate(host, guard_id, g)? } else { g };
    let balances: Vec<Value> = list.iter().map(|(t, b)| json!({ "token": t, "balance": b })).collect();
    let sealed = seal_to_owner(host, guard_id, &g, &json!({ "balances": balances }))?;
    Ok(json!({ "status": "guarding", "sealed": sealed }))
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
