//! The agent key for isolated positions (ARCHITECTURE §4.6): the guard wallet's own EVM key, which the owner approves
//! once on Hyperliquid. A rescue credits the account's balance; an isolated position only gets that margin through
//! `updateIsolatedMargin`. This is the only action Ripcord ever signs with the key, and `ntli` is unsigned, so it can
//! only add (T-SEC-07). Formats from hyperliquid-python-sdk `signing.py` and `exchange.py`; the same
//! message moved a real position on mainnet.
use crate::custody::Custody;
use crate::host::Host;
use serde_json::{json, Value};
use sha3::{Digest, Keccak256};

/// How long a signed action stays valid: a delayed copy can't land later.
pub const EXPIRES_MS: u64 = 60_000;

fn msgpack_str(out: &mut Vec<u8>, s: &str) {
    out.push(0xa0 | s.len() as u8); // fixstr: every string here is under 32 bytes
    out.extend_from_slice(s.as_bytes());
}

fn msgpack_uint(out: &mut Vec<u8>, n: u64) {
    match n {
        0..=0x7f => out.push(n as u8),
        0x80..=0xff => out.extend([0xcc, n as u8]),
        0x100..=0xffff => {
            out.push(0xcd);
            out.extend_from_slice(&(n as u16).to_be_bytes());
        }
        0x1_0000..=0xffff_ffff => {
            out.push(0xce);
            out.extend_from_slice(&(n as u32).to_be_bytes());
        }
        _ => {
            out.push(0xcf);
            out.extend_from_slice(&n.to_be_bytes());
        }
    }
}

/// `msgpack.packb({"type", "asset", "isBuy": True, "ntli"})`, in the SDK's key order. `isBuy` has no effect until
/// Hyperliquid has hedge mode, and the SDK always sends true.
fn packed(asset: u32, ntli: u64) -> Vec<u8> {
    let mut out = vec![0x84];
    msgpack_str(&mut out, "type");
    msgpack_str(&mut out, "updateIsolatedMargin");
    msgpack_str(&mut out, "asset");
    msgpack_uint(&mut out, u64::from(asset));
    msgpack_str(&mut out, "isBuy");
    out.push(0xc3);
    msgpack_str(&mut out, "ntli");
    msgpack_uint(&mut out, ntli);
    out
}

/// keccak(action ‖ nonce ‖ no vault ‖ expiresAfter): what Hyperliquid signs as the phantom agent's connection id.
pub fn action_hash(asset: u32, ntli: u64, nonce: u64, expires_after: u64) -> [u8; 32] {
    let mut data = packed(asset, ntli);
    data.extend_from_slice(&nonce.to_be_bytes());
    data.push(0);
    data.push(0);
    data.extend_from_slice(&expires_after.to_be_bytes());
    Keccak256::digest(&data).into()
}

/// The EIP-712 message for an L1 action: domain "Exchange" on chain 1337, source "a" on Hyperliquid's mainnet.
pub fn typed_data(hash: &[u8; 32], mainnet: bool) -> Value {
    json!({
        "domain": {
            "chainId": 1337, "name": "Exchange", "version": "1",
            "verifyingContract": "0x0000000000000000000000000000000000000000",
        },
        "types": {
            "Agent": [{ "name": "source", "type": "string" }, { "name": "connectionId", "type": "bytes32" }],
            "EIP712Domain": [
                { "name": "name", "type": "string" }, { "name": "version", "type": "string" },
                { "name": "chainId", "type": "uint256" }, { "name": "verifyingContract", "type": "address" },
            ],
        },
        "primaryType": "Agent",
        "message": { "source": if mainnet { "a" } else { "b" }, "connectionId": format!("0x{}", hex::encode(hash)) },
    })
}

/// What Hyperliquid answered.
#[derive(Debug, PartialEq)]
pub enum Moved {
    Done,
    /// It refused: nothing moved. `nonce` says the nonce was the reason, which after a lost answer means the first
    /// send went through.
    Refused {
        nonce: bool,
    },
    /// No clear answer: send the same nonce again, so it can't be applied twice.
    Unknown,
}

/// Adds `ntli` (USDC × 1e6) to the isolated position on `asset`. `nonce` belongs to this move, kept by the caller.
pub fn add_margin(
    host: &dyn Host,
    custody: &Custody,
    api: &str,
    guard_id: &str,
    asset: u32,
    ntli: u64,
    nonce: u64,
) -> Result<Moved, String> {
    let expires_after = host.now_ms() + EXPIRES_MS;
    let hash = action_hash(asset, ntli, nonce, expires_after);
    let (r, s, v) = custody.sign_typed_data(guard_id, &typed_data(&hash, !api.contains("testnet")))?;
    let body = json!({
        "action": { "type": "updateIsolatedMargin", "asset": asset, "isBuy": true, "ntli": ntli },
        "nonce": nonce,
        "signature": { "r": r, "s": s, "v": v },
        "vaultAddress": null,
        "expiresAfter": expires_after,
    });
    let answer = host.http(
        "POST",
        &format!("{api}/exchange"),
        &[("Content-Type", "application/json".into())],
        Some(body.to_string().as_bytes()),
    );
    let Ok((200, raw)) = answer else {
        return Ok(Moved::Unknown);
    };
    let v: Value = serde_json::from_slice(&raw).unwrap_or(Value::Null);
    Ok(match v["status"].as_str() {
        Some("ok") => Moved::Done,
        Some("err") => Moved::Refused {
            nonce: v["response"]
                .as_str()
                .is_some_and(|m| m.to_ascii_lowercase().contains("nonce")),
        },
        _ => Moved::Unknown,
    })
}
