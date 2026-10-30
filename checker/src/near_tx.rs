//! The checker signs its own NEAR transactions with its enclave key (no operator key ever drives the registry):
//! borsh encoding of a single function-call transaction, checked byte for byte against near-api-js
//! (packages/shared/vectors/near-tx.json), and the two RPC calls it needs.
use crate::host::Host;
use serde_json::{json, Value};

pub struct FunctionCall<'a> {
    pub signer_id: &'a str,
    pub public_key: [u8; 32],
    pub nonce: u64,
    pub receiver_id: &'a str,
    pub block_hash: [u8; 32],
    pub method: &'a str,
    pub args: &'a [u8],
    pub gas: u64,
    pub deposit: u128,
}

fn string(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s.as_bytes());
}

/// borsh(Transaction { signer_id, public_key: ED25519, nonce, receiver_id, block_hash, actions: [FunctionCall] }).
pub fn encode(t: &FunctionCall) -> Vec<u8> {
    let mut b = Vec::with_capacity(256 + t.args.len());
    string(&mut b, t.signer_id);
    b.push(0); // KeyType::ED25519
    b.extend_from_slice(&t.public_key);
    b.extend_from_slice(&t.nonce.to_le_bytes());
    string(&mut b, t.receiver_id);
    b.extend_from_slice(&t.block_hash);
    b.extend_from_slice(&1u32.to_le_bytes()); // one action
    b.push(2); // Action::FunctionCall
    string(&mut b, t.method);
    b.extend_from_slice(&(t.args.len() as u32).to_le_bytes());
    b.extend_from_slice(t.args);
    b.extend_from_slice(&t.gas.to_le_bytes());
    b.extend_from_slice(&t.deposit.to_le_bytes());
    b
}

/// The 32 bytes the key signs: sha256 of the encoded transaction.
pub fn hash(encoded: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(encoded).into()
}

/// borsh(SignedTransaction { transaction, signature: ED25519 }).
pub fn signed(encoded: &[u8], signature: &[u8; 64]) -> Vec<u8> {
    let mut b = Vec::with_capacity(encoded.len() + 65);
    b.extend_from_slice(encoded);
    b.push(0);
    b.extend_from_slice(signature);
    b
}

const B58: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

pub fn bs58_encode(bytes: &[u8]) -> String {
    let mut digits: Vec<u8> = Vec::new();
    for &byte in bytes {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let zeros = bytes.iter().take_while(|&&b| b == 0).count();
    std::iter::repeat_n('1', zeros)
        .chain(digits.iter().rev().map(|&d| B58[d as usize] as char))
        .collect()
}

pub fn bs58_decode(s: &str) -> Option<Vec<u8>> {
    let mut bytes: Vec<u8> = Vec::new();
    for c in s.bytes() {
        let mut carry = B58.iter().position(|&x| x == c)? as u32;
        for b in bytes.iter_mut() {
            carry += (*b as u32) * 58;
            *b = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            bytes.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let zeros = s.bytes().take_while(|&c| c == b'1').count();
    Some(std::iter::repeat_n(0u8, zeros).chain(bytes.into_iter().rev()).collect())
}

fn rpc(host: &dyn Host, url: &str, method: &str, params: Value) -> Result<Value, String> {
    let body = json!({ "jsonrpc": "2.0", "id": "ripcord", "method": method, "params": params }).to_string();
    let (code, raw) = host.http(
        "POST",
        url,
        &[("Content-Type", "application/json".into())],
        Some(body.as_bytes()),
    )?;
    let v: Value = serde_json::from_slice(&raw).map_err(|_| format!("rpc {method}: HTTP {code}, not JSON"))?;
    if let Some(e) = v.get("error") {
        return Err(format!(
            "rpc {method}: {}",
            e["cause"]["name"].as_str().unwrap_or("error")
        ));
    }
    Ok(v["result"].clone())
}

/// The next nonce and a recent block hash for (account, key).
pub fn access_key(host: &dyn Host, url: &str, account: &str, public_key: &[u8; 32]) -> Result<(u64, [u8; 32]), String> {
    let r = rpc(
        host,
        url,
        "query",
        json!({ "request_type": "view_access_key", "finality": "final", "account_id": account,
                "public_key": format!("ed25519:{}", bs58_encode(public_key)) }),
    )?;
    let nonce = r["nonce"].as_u64().ok_or("access key has no nonce")?;
    let hash = bs58_decode(r["block_hash"].as_str().ok_or("no block_hash")?).ok_or("block_hash is not base58")?;
    Ok((nonce + 1, hash.try_into().map_err(|_| "block_hash is not 32 bytes")?))
}

/// Signs `call` with the checker's enclave key and broadcasts it, waiting until it executes.
/// Returns the transaction hash, or the receipt failure's message.
pub fn send(host: &dyn Host, url: &str, key_path: &str, call: &FunctionCall) -> Result<String, String> {
    let encoded = encode(call);
    let digest = hash(&encoded);
    let signature = host.sign(key_path, &digest)?;
    use base64::Engine;
    let tx = base64::engine::general_purpose::STANDARD.encode(signed(&encoded, &signature));
    let r = rpc(
        host,
        url,
        "send_tx",
        json!({ "signed_tx_base64": tx, "wait_until": "EXECUTED_OPTIMISTIC" }),
    )?;
    let failure = std::iter::once(&r["transaction_outcome"])
        .chain(r["receipts_outcome"].as_array().into_iter().flatten())
        .find_map(|o| o["outcome"]["status"].get("Failure"));
    match failure {
        Some(f) => Err(format!(
            "transaction failed: {}",
            f.to_string().chars().take(160).collect::<String>()
        )),
        None => Ok(bs58_encode(&digest)),
    }
}
