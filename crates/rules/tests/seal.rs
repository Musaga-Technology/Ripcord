//! The Rust seal against the vectors the TypeScript implementation wrote (packages/shared/vectors/seal.json):
//! two independent libraries (RustCrypto here, @noble there) must produce the same bytes.
use ripcord_rules::seal::{open, public_key, seal_with, SealError};
use serde_json::Value;

fn h<const N: usize>(s: &str) -> [u8; N] {
    hex::decode(s).unwrap().try_into().unwrap()
}

#[test]
fn matches_the_typescript_seal_byte_for_byte() {
    let v: Value = serde_json::from_str(include_str!("../../../packages/shared/vectors/seal.json")).unwrap();
    let secret: [u8; 32] = h(v["recipient_secret"].as_str().unwrap());
    assert_eq!(hex::encode(public_key(&secret)), v["recipient_pk"].as_str().unwrap());
    for c in v["cases"].as_array().unwrap() {
        let gid = c["guard_id"].as_str().unwrap();
        let pt = c["plaintext"].as_str().unwrap().as_bytes();
        let env = seal_with(
            &h(c["eph_secret"].as_str().unwrap()),
            &h(c["nonce"].as_str().unwrap()),
            &public_key(&secret),
            pt,
            gid,
        );
        assert_eq!(hex::encode(&env), c["envelope"].as_str().unwrap());
        assert_eq!(
            open(&secret, &hex::decode(c["envelope"].as_str().unwrap()).unwrap(), gid).unwrap(),
            pt
        );
    }
}

#[test]
fn refuses_what_it_should() {
    let v: Value = serde_json::from_str(include_str!("../../../packages/shared/vectors/seal.json")).unwrap();
    let secret: [u8; 32] = h(v["recipient_secret"].as_str().unwrap());
    let c = &v["cases"][0];
    let env = hex::decode(c["envelope"].as_str().unwrap()).unwrap();
    let gid = c["guard_id"].as_str().unwrap();
    assert_eq!(open(&secret, &env, "g-aaaaaaaaaa"), Err(SealError::Open));
    assert_eq!(open(&[7u8; 32], &env, gid), Err(SealError::Open));
    let mut tampered = env.clone();
    *tampered.last_mut().unwrap() ^= 1;
    assert_eq!(open(&secret, &tampered, gid), Err(SealError::Open));
    assert_eq!(open(&secret, &env[..20], gid), Err(SealError::Format));
}
