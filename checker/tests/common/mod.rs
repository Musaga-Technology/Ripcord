//! A fake network for the checker's tests: OutLayer's custody API, NEAR RPC (view, access key, send_tx), 1Click's
//! token list and Hyperliquid's `clearinghouseState`, answering the shapes the checker reads. Every request body is kept for assertions.
#![allow(dead_code)]
use base64::Engine;
use ripcord_checker::config::NET;
use ripcord_checker::host::MockHost;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Default)]
pub struct Net {
    /// (url, body) of every request.
    pub requests: Vec<(String, String)>,
    /// Guards `register_guard` has stored.
    pub registered: Vec<String>,
    /// Signed transactions, base64-decoded.
    pub txs: Vec<Vec<u8>>,
    /// Answer `send_tx` with a receipt failure.
    pub fail_tx: bool,
    /// Registry methods called, in order (`register_guard`, `record_arm`, `set_status`).
    pub methods: Vec<String>,
    /// What Hyperliquid answers for `clearinghouseState`.
    pub hl_state: Value,
    /// The HTTP status OutLayer answers a withdraw with (0 means 200).
    pub withdraw_code: u16,
    /// Bodies of accepted withdraws.
    pub withdraws: Vec<Value>,
    /// What polling a request answers, one per poll in order; `success` once they run out.
    pub polls: std::collections::VecDeque<&'static str>,
    /// Bodies of accepted swaps and transfers.
    pub swaps: Vec<Value>,
    pub transfers: Vec<Value>,
    /// Accepted requests: id → the amount a success delivers.
    pub pending: std::collections::HashMap<String, String>,
}

/// One position as Hyperliquid's `clearinghouseState` lists it (numbers as strings).
pub fn position(coin: &str, szi: f64, mark: f64, liq: Option<f64>, max_lev: u32, kind: &str) -> Value {
    json!({ "type": "oneWay", "position": {
        "coin": coin, "szi": szi.to_string(), "leverage": { "type": kind, "value": 5 },
        "positionValue": (szi.abs() * mark).to_string(), "liquidationPx": liq.map(|l| l.to_string()),
        "maxLeverage": max_lev, "marginUsed": "0", "entryPx": mark.to_string(),
    } })
}

pub fn state(positions: Vec<Value>) -> Value {
    json!({ "assetPositions": positions, "marginSummary": {}, "crossMarginSummary": {}, "withdrawable": "0", "time": 0 })
}

pub fn host(seed: u8) -> (MockHost, Rc<RefCell<Net>>) {
    let net = Rc::new(RefCell::new(Net::default()));
    let mut host = MockHost::new(seed);
    let n = net.clone();
    host.responder = Box::new(move |_, url, body| {
        let body = body
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default();
        n.borrow_mut().requests.push((url.to_string(), body.clone()));
        let ok = |v: Value| (200, v.to_string().into_bytes());
        let path = url
            .split_once("://")
            .map(|(_, r)| r.split_once('/').map_or("", |x| x.1))
            .unwrap_or("");
        if url.starts_with(NET.rpc) {
            let req: Value = serde_json::from_str(&body).unwrap();
            let p = &req["params"];
            let result = match (req["method"].as_str().unwrap(), p["request_type"].as_str()) {
                ("query", Some("call_function")) => {
                    let args: Value = serde_json::from_slice(
                        &base64::engine::general_purpose::STANDARD
                            .decode(p["args_base64"].as_str().unwrap())
                            .unwrap(),
                    )
                    .unwrap();
                    let gid = args["guard_id"].as_str().unwrap().to_string();
                    let v = if n.borrow().registered.contains(&gid) {
                        json!({ "status": "Pending" })
                    } else {
                        Value::Null
                    };
                    json!({ "result": v.to_string().into_bytes() })
                }
                ("query", Some("view_access_key")) => {
                    json!({ "nonce": 41, "block_hash": "11111111111111111111111111111111" })
                }
                ("send_tx", _) => {
                    let tx = base64::engine::general_purpose::STANDARD
                        .decode(p["signed_tx_base64"].as_str().unwrap())
                        .unwrap();
                    let text = String::from_utf8_lossy(&tx).into_owned();
                    let mut net = n.borrow_mut();
                    net.txs.push(tx);
                    let method = [
                        "register_guard",
                        "record_arm",
                        "record_rescue",
                        "record_outcome",
                        "set_status",
                    ]
                    .into_iter()
                    .find(|m| text.contains(m))
                    .unwrap_or("?");
                    if net.fail_tx {
                        json!({ "transaction_outcome": { "outcome": { "status": { "SuccessReceiptId": "x" } } },
                                "receipts_outcome": [{ "outcome": { "status": { "Failure": { "ActionError": "guard_id already registered" } } } }] })
                    } else {
                        net.methods.push(method.to_string());
                        let gid = text.split("\"guard_id\":\"").nth(1).unwrap().split('"').next().unwrap();
                        if method == "register_guard" {
                            net.registered.push(gid.to_string());
                        }
                        json!({ "transaction_outcome": { "outcome": { "status": { "SuccessReceiptId": "x" } } }, "receipts_outcome": [] })
                    }
                }
                _ => return (400, b"{}".to_vec()),
            };
            return ok(json!({ "jsonrpc": "2.0", "id": "ripcord", "result": result }));
        }
        if url == format!("{}/info", NET.hyperliquid) {
            let st = n.borrow().hl_state.clone();
            return ok(if st.is_null() { state(vec![]) } else { st });
        }
        if url.starts_with(NET.oneclick) && path == "v0/tokens" {
            return ok(json!([
                { "assetId": "nep141:wrap.near", "decimals": 24, "price": 2.5, "blockchain": "near", "symbol": "wNEAR" },
                { "assetId": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", "decimals": 6, "price": 1.0,
                  "blockchain": "arb", "symbol": "USDC" },
            ]));
        }
        if url.starts_with(NET.outlayer_api) {
            let req: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            return match path {
                "register" => ok(
                    json!({ "wallet_id": format!("w-{}", req["seed"].as_str().unwrap()), "near_account_id": "ab".repeat(32) }),
                ),
                "wallet/v1/encrypt-policy" => ok(json!({ "encrypted_base64": "ZW5jcnlwdGVk" })),
                "wallet/v1/sign-policy" => {
                    ok(json!({ "signature_hex": "5a".repeat(64), "public_key_hex": "cd".repeat(32) }))
                }
                "wallet/v1/confidential/deposit/cross-chain" => {
                    ok(json!({ "intent_id": "i-1", "deposit_address": "0xDEP0517", "amount": req["amount"] }))
                }
                "wallet/v1/confidential/withdraw" => {
                    let mut net = n.borrow_mut();
                    match net.withdraw_code {
                        0 | 200 => {
                            let id = format!("req-{}", net.withdraws.len() + 1);
                            net.pending
                                .insert(id.clone(), req["amount"].as_str().unwrap().to_string());
                            net.withdraws.push(req);
                            ok(json!({ "request_id": id, "status": "pending_deposit" }))
                        }
                        code => (code, b"{}".to_vec()),
                    }
                }
                "wallet/v1/confidential/swap" => {
                    let mut net = n.borrow_mut();
                    let id = format!("swap-{}", net.swaps.len() + 1);
                    net.pending
                        .insert(id.clone(), req["min_amount_out"].as_str().unwrap().to_string());
                    net.swaps.push(req);
                    ok(json!({ "request_id": id, "status": "pending_deposit" }))
                }
                "wallet/v1/confidential/transfer" => {
                    let mut net = n.borrow_mut();
                    let id = format!("xfer-{}", net.transfers.len() + 1);
                    net.transfers.push(req);
                    ok(json!({ "request_id": id, "status": "pending_deposit" }))
                }
                p if p.starts_with("wallet/v1/requests/") => {
                    let mut net = n.borrow_mut();
                    let id = &p["wallet/v1/requests/".len()..];
                    let Some(amount) = net.pending.get(id).cloned() else {
                        return (404, b"{}".to_vec());
                    };
                    match net.polls.pop_front().unwrap_or("success") {
                        "success" => ok(json!({ "status": "success", "result": {
                            "amount_out": amount,
                            "swap_details": { "destinationChainTxHashes": [format!("0xhl{id}")] } } })),
                        other => ok(json!({ "status": other, "result": {} })),
                    }
                }
                _ => (404, b"{}".to_vec()),
            };
        }
        (404, b"{}".to_vec())
    });
    (host, net)
}
