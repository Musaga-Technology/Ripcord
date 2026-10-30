//! The checker's NEAR transaction encoding against near-api-js (packages/shared/vectors/near-tx.json), and the
//! RPC calls against a scripted host.
use ed25519_dalek::{Signer, SigningKey};
use ripcord_checker::host::MockHost;
use ripcord_checker::near_tx::{access_key, bs58_decode, bs58_encode, encode, hash, signed, FunctionCall};
use serde_json::{json, Value};

fn h<const N: usize>(s: &str) -> [u8; N] {
    hex::decode(s).unwrap().try_into().unwrap()
}

#[test]
fn encodes_and_signs_exactly_like_near_api_js() {
    let v: Value = serde_json::from_str(include_str!("../../packages/shared/vectors/near-tx.json")).unwrap();
    let key = SigningKey::from_bytes(&h(v["secret_seed"].as_str().unwrap()));
    assert_eq!(
        hex::encode(key.verifying_key().to_bytes()),
        v["public_key"].as_str().unwrap()
    );
    for c in v["cases"].as_array().unwrap() {
        let args = c["args_json"].as_str().unwrap().as_bytes();
        let call = FunctionCall {
            signer_id: v["signer_id"].as_str().unwrap(),
            public_key: h(v["public_key"].as_str().unwrap()),
            nonce: c["nonce"].as_str().unwrap().parse().unwrap(),
            receiver_id: c["receiver_id"].as_str().unwrap(),
            block_hash: h(c["block_hash"].as_str().unwrap()),
            method: c["method"].as_str().unwrap(),
            args,
            gas: c["gas"].as_str().unwrap().parse().unwrap(),
            deposit: c["deposit"].as_str().unwrap().parse().unwrap(),
        };
        let encoded = encode(&call);
        assert_eq!(hex::encode(&encoded), c["encoded"].as_str().unwrap());
        let digest = hash(&encoded);
        assert_eq!(hex::encode(digest), c["hash"].as_str().unwrap());
        let sig = key.sign(&digest).to_bytes();
        assert_eq!(hex::encode(signed(&encoded, &sig)), c["signed"].as_str().unwrap());
    }
}

#[test]
fn base58_round_trips() {
    for b in [vec![], vec![0, 0, 1], (0..32).collect::<Vec<u8>>(), vec![255; 32]] {
        assert_eq!(bs58_decode(&bs58_encode(&b)).unwrap(), b);
    }
    assert_eq!(bs58_encode(&[0, 0, 0x28, 0x7f, 0xb4, 0xcd]), "11233QC4");
}

#[test]
fn reads_the_next_nonce_and_a_block_hash() {
    let mut host = MockHost::new(1);
    let block = [7u8; 32];
    let b58 = bs58_encode(&block);
    host.responder = Box::new(move |_, _, _| {
        (
            200,
            json!({ "jsonrpc": "2.0", "id": "ripcord", "result": { "nonce": 41, "block_hash": b58 } })
                .to_string()
                .into_bytes(),
        )
    });
    let (nonce, hash) = access_key(&host, "https://rpc.example", "checker", &[1u8; 32]).unwrap();
    assert_eq!((nonce, hash), (42, block));
}
