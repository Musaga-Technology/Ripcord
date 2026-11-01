//! Calls to the guard registry, signed by the checker's own enclave key (never an operator key).
use crate::actions::CHECKER_KEY;
use crate::config::NET;
use crate::host::Host;
use crate::near_tx::{self, FunctionCall};
use serde_json::Value;

pub const TGAS: u64 = 1_000_000_000_000;

pub fn call(host: &dyn Host, method: &str, args: &Value, gas: u64, deposit: u128) -> Result<String, String> {
    let pk = host.public_key(CHECKER_KEY)?;
    let account = hex::encode(pk);
    let (nonce, block_hash) = near_tx::access_key(host, NET.rpc, &account, &pk)?;
    let args = args.to_string();
    near_tx::send(
        host,
        NET.rpc,
        CHECKER_KEY,
        &FunctionCall {
            signer_id: &account,
            public_key: pk,
            nonce,
            receiver_id: NET.registry,
            block_hash,
            method,
            args: args.as_bytes(),
            gas,
            deposit,
        },
    )
}

pub fn view(host: &dyn Host, method: &str, args: &Value) -> Result<Value, String> {
    near_tx::view(host, NET.rpc, NET.registry, method, args)
}
