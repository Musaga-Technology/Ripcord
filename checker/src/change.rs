//! The owner's top-up and new range (docs/SPEC.md §3). Both change what is sealed, so both are signed with the owner
//! key from the seal file and carried out here. A top-up raises the sealed budget and the wallet's daily cap, then
//! gives a private deposit address; a new range swaps the guard's fingerprint on the registry and draws the next line
//! inside it. The amount and the range arrive sealed to this enclave, so Ripcord's servers relay them unread.
use crate::actions::{reserve_units, StoredGuard};
use crate::check::{arm, seal_to_owner, Stage, Track};
use crate::config::{NET, OWNER_GAS, TOPUP_DEPOSIT, TOPUP_GAS};
use crate::custody::Custody;
use crate::host::Host;
use crate::{close, oneclick, owner, policy, registry, settings, vault};
use ripcord_rules::commitment::{commitment, is_guard_id};
use ripcord_rules::seal;
use ripcord_rules::types::Preset;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

/// The route to Hyperliquid carries $2 and up, so a smaller top-up could never be paid out.
const MIN_TOPUP_CENTS: u64 = 200;
const MAX_TOPUP_CENTS: u64 = 100_000_000;

#[derive(Deserialize)]
pub struct TopupInput {
    pub guard_id: String,
    /// `{ "cents", "salt" }` sealed to this enclave, hex.
    pub enc_amount: String,
    /// The 1Click asset the owner sends from.
    pub source_asset: String,
    pub owner_salt: String,
    pub sig: String,
    pub nonce: String,
}

#[derive(Deserialize)]
struct Amount {
    cents: u64,
    salt: String,
}

#[derive(Deserialize)]
pub struct ResealInput {
    pub guard_id: String,
    /// `{ "preset", "line_range_pct", "target_range_pct" }` sealed to this enclave, hex.
    pub enc_range: String,
    /// The fingerprint of the settings with the new range: what the owner signed.
    pub commitment: String,
    pub owner_salt: String,
    pub sig: String,
    pub nonce: String,
}

#[derive(Deserialize)]
struct Range {
    preset: Preset,
    line_range_pct: [f64; 2],
    target_range_pct: [f64; 2],
}

fn stored(host: &dyn Host, guard_id: &str) -> Result<(String, StoredGuard), String> {
    if !is_guard_id(guard_id) {
        return Err("invalid guard_id".into());
    }
    if close::is_closing(host, guard_id)? {
        return Err("the guard is closing".into());
    }
    let key = format!("s/{guard_id}");
    let g = vault::get(host, &key)?.ok_or("no such guard")?;
    Ok((key, g))
}

fn open_sealed<T: DeserializeOwned>(host: &dyn Host, guard_id: &str, hex_envelope: &str) -> Result<T, String> {
    let envelope = hex::decode(hex_envelope).map_err(|_| "the sealed part must be hex")?;
    let plain = seal::open(&vault::seal_secret(host)?, &envelope, guard_id)
        .map_err(|_| "the sealed part does not open for this guard")?;
    serde_json::from_slice(&plain).map_err(|_| "the sealed part is malformed".into())
}

pub fn topup(host: &dyn Host, i: &TopupInput) -> Result<Value, String> {
    let (key, mut g) = stored(host, &i.guard_id)?;
    if g.registered.is_none() {
        return Err("fund the guard first".into());
    }
    let a: Amount = open_sealed(host, &i.guard_id, &i.enc_amount)?;
    if !(MIN_TOPUP_CENTS..=MAX_TOPUP_CENTS).contains(&a.cents) || a.salt.len() < 16 {
        return Err("a top-up is $2 or more".into());
    }
    let digest = owner::topup_digest(&i.guard_id, a.cents, &a.salt);
    let message = owner::topup_message(&i.guard_id, &digest, &i.nonce);
    if !owner::verify(&g.settings.owner, &message, &i.nonce, &i.sig, NET.registry) {
        return Err("the top-up is not signed by this guard's owner".into());
    }
    let usd = a.cents as f64 / 100.0;
    if !g.topups.contains(&i.nonce) {
        // The wallet's daily cap follows the budget, so it rises first. The registry checks the owner's signature;
        // a failed attempt raises nothing, and the owner's next one signs a fresh nonce.
        let mut raised = g.settings.clone();
        raised.budget_usd += g.added_usd + usd;
        let custody = Custody::new(host, NET.outlayer_api)?;
        let wallet_id = custody.register(&i.guard_id)?;
        let p = policy::build(&raised, NET.fee_wallet, reserve_units(host, &raised)?)?;
        let encrypted = custody.encrypt_policy(&i.guard_id, &wallet_id, &p)?;
        let signed = custody.sign_policy(&i.guard_id, &encrypted, NET.registry)?;
        let args = json!({
            "guard_id": i.guard_id,
            "digest": digest,
            "encrypted_policy": encrypted,
            "wallet_signature": signed.signature,
            "policy_version": signed.version,
            "policy_valid_until": signed.valid_until,
            "owner": g.settings.owner,
            "owner_salt": i.owner_salt,
            "sig": i.sig,
            "nonce": i.nonce,
        });
        registry::call(host, "top_up", &args, TOPUP_GAS, TOPUP_DEPOSIT)?;
        g.added_usd += usd;
        g.topups.push(i.nonce.clone());
        vault::put(host, &key, &g)?;
    }
    let t = oneclick::token(host, NET.oneclick, &i.source_asset)?;
    let amount = ((usd * t.per_usd()).ceil() as u128).to_string();
    let tag = format!("topup-{}", i.nonce);
    let address = Custody::new(host, NET.outlayer_api)?.deposit_address(&i.guard_id, &i.source_asset, &amount, &tag)?;
    let sealed = seal_to_owner(
        host,
        &i.guard_id,
        &g,
        &json!({ "deposit_address": address, "amount": amount, "decimals": t.decimals }),
    )?;
    Ok(json!({ "status": "pending", "sealed": sealed }))
}

/// A rescue on its way, or one that landed inside the cooldown: the next line waits for it.
fn landing(t: &Track, cooldown_s: u64, now: u64) -> bool {
    t.rescues.iter().any(|r| match r.stage {
        Stage::Swapping | Stage::Withdrawing => true,
        Stage::Credited => now < r.credited_ms.unwrap_or(r.at_ms) + cooldown_s * 1000,
        Stage::Failed => false,
    })
}

pub fn reseal(host: &dyn Host, i: &ResealInput) -> Result<Value, String> {
    let (key, mut g) = stored(host, &i.guard_id)?;
    let r: Range = open_sealed(host, &i.guard_id, &i.enc_range)?;
    let mut s = g.settings.clone();
    (s.preset, s.line_range_pct, s.target_range_pct) = (r.preset, r.line_range_pct, r.target_range_pct);
    settings::validate(&s, host.now_ms())?;
    let c = commitment(&s, &g.salt).map_err(|_| "the new settings do not hash")?;
    if c != i.commitment {
        return Err("the new range does not match the signed fingerprint".into());
    }
    if !owner::verify(
        &g.settings.owner,
        &owner::reseal_message(&i.guard_id, &c, &i.nonce),
        &i.nonce,
        &i.sig,
        NET.registry,
    ) {
        return Err("the new range is not signed by this guard's owner".into());
    }
    let track_key = format!("t/{}", i.guard_id);
    let mut track: Option<Track> = vault::get(host, &track_key)?;
    if g.commitment == c {
        let from_epoch = track.map_or(0, |t| t.epoch);
        return Ok(json!({ "status": "resealed", "from_epoch": from_epoch }));
    }
    if track
        .as_ref()
        .is_some_and(|t| landing(t, g.settings.cooldown_s, host.now_ms()))
    {
        return Err("a rescue is landing; change the range once it has".into());
    }
    if g.registered.is_some() {
        let args = json!({
            "guard_id": i.guard_id, "commitment": c, "owner": g.settings.owner, "owner_salt": i.owner_salt,
            "sig": i.sig, "nonce": i.nonce,
        });
        registry::call(host, "reseal", &args, OWNER_GAS, 0)?;
    }
    (g.settings, g.commitment) = (s, c);
    vault::put(host, &key, &g)?;
    // The next line is drawn from the new range under a new epoch, so the owner's Verify knows which range drew it.
    let from_epoch = match track.as_mut() {
        Some(t) => {
            let (line, target) = arm(host, &i.guard_id, &g, t.epoch + 1)?;
            (t.epoch, t.line, t.target) = (t.epoch + 1, line, target);
            vault::put(host, &track_key, t)?;
            t.epoch
        }
        None => 0,
    };
    Ok(json!({ "status": "resealed", "from_epoch": from_epoch }))
}
