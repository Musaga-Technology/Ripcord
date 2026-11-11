//! The owner's close (docs/SPEC.md §3). Signed with the owner key from the seal file, it stops the guard's rescues,
//! sends the rest of the reserve to the owner's own Hyperliquid account (the only recipient its wallet allows), then
//! closes the guard on the registry, which deletes the wallet's policy and refunds its storage. Each call moves it one
//! step; the owner's page calls again until it answers `closed`.
use crate::actions::StoredGuard;
use crate::config::{NET, OWNER_GAS};
use crate::custody::{Custody, Op, Request};
use crate::host::Host;
use crate::{oneclick, owner, policy, registry, vault};
use ripcord_rules::commitment::is_guard_id;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The smallest payout the route to Hyperliquid carries; less stays in the wallet.
const MIN_PAYOUT_UNITS: u128 = 2_000_000;

#[derive(Deserialize)]
pub struct CloseInput {
    pub guard_id: String,
    pub sig: String,
    pub nonce: String,
}

/// Kept in the vault under `c/<guard_id>` from the first signed close: a guard with one is never rescued again.
#[derive(Serialize, Deserialize, Default)]
pub struct Closing {
    /// The leg in flight: `swap` (a non-USDC reserve into USDC) or `withdraw` (to Hyperliquid).
    pub leg: Option<String>,
    pub request_id: Option<String>,
    /// Bumped when a leg is refunded, so the next one goes under a fresh key.
    pub attempt: u32,
    pub paid: bool,
    pub done: bool,
}

pub fn is_closing(host: &dyn Host, guard_id: &str) -> Result<bool, String> {
    Ok(vault::get::<Closing>(host, &format!("c/{guard_id}"))?.is_some())
}

pub fn close(host: &dyn Host, c: &CloseInput) -> Result<Value, String> {
    if !is_guard_id(&c.guard_id) {
        return Err("invalid guard_id".into());
    }
    let g: StoredGuard = vault::get(host, &format!("s/{}", c.guard_id))?.ok_or("no such guard")?;
    let s = &g.settings;
    let message = owner::close_message(&c.guard_id, "hypercore", &s.hl_address, &c.nonce);
    if !owner::verify(&s.owner, &message, &c.nonce, &c.sig, NET.registry) {
        return Err("the close is not signed by this guard's owner".into());
    }
    let key = format!("c/{}", c.guard_id);
    let mut st: Closing = vault::get(host, &key)?.unwrap_or_default();
    if st.done {
        return Ok(json!({ "status": "closed" }));
    }
    vault::put(host, &key, &st)?;
    let custody = Custody::new(host, NET.outlayer_api)?;

    if let Some(id) = st.request_id.clone() {
        match custody.status(&c.guard_id, &id)? {
            Request::Pending => return Ok(json!({ "status": "pending" })),
            Request::Success { .. } => {
                st.paid = st.leg.as_deref() == Some("withdraw");
                st.leg = None;
                st.request_id = None;
            }
            Request::Refunded | Request::Failed => {
                st.leg = None;
                st.request_id = None;
                st.attempt += 1;
            }
        }
        vault::put(host, &key, &st)?;
    }

    if !st.paid {
        let Some(balances) = custody.balances(&c.guard_id)? else {
            return Err("the private route is unavailable".into());
        };
        let units = |token: &str| {
            balances
                .iter()
                .find(|(t, _)| t == token)
                .and_then(|(_, b)| b.parse::<u128>().ok())
                .unwrap_or(0)
        };
        let tag = format!("{}-close-{}", c.guard_id, st.attempt);
        let rest = if s.reserve_asset == policy::USDC {
            0
        } else {
            units(&s.reserve_asset)
        };
        let usdc = units(policy::USDC);
        let next = if rest > 0 {
            // The rest of a non-USDC reserve becomes USDC first, refused under 97 % of its listed value.
            let tok = oneclick::token(host, NET.oneclick, &s.reserve_asset)?;
            let min_out = ((rest as f64 / tok.per_usd() * 0.97 * 1e6).floor() as u128).to_string();
            let swap_key = format!("{tag}-swap");
            Some((
                "swap",
                custody.swap(
                    &c.guard_id,
                    &s.reserve_asset,
                    policy::USDC,
                    &rest.to_string(),
                    &min_out,
                    &swap_key,
                )?,
            ))
        } else if usdc >= MIN_PAYOUT_UNITS {
            Some((
                "withdraw",
                custody.withdraw(&c.guard_id, &s.hl_address, &usdc.to_string(), policy::USDC, &tag)?,
            ))
        } else {
            None
        };
        match next {
            // Nothing left that the route can carry: close without a payout.
            None => st.paid = true,
            Some((leg, Op::Accepted(id))) => {
                st.leg = Some(leg.into());
                st.request_id = Some(id);
                vault::put(host, &key, &st)?;
                return Ok(json!({ "status": "pending" }));
            }
            // Sent again under the same key on the next call.
            Some((_, Op::Retry | Op::Busy)) => return Ok(json!({ "status": "pending" })),
            Some((_, Op::Unavailable)) => return Err("the private route is unavailable".into()),
        }
        vault::put(host, &key, &st)?;
    }

    if g.registered.is_some() {
        let on_chain = registry::view(host, "get_guard", &json!({ "guard_id": c.guard_id }))?;
        if on_chain["status"] != "Closed" {
            registry::call(host, "close", &json!({ "guard_id": c.guard_id }), OWNER_GAS, 0)?;
        }
    }
    st.done = true;
    vault::put(host, &key, &st)?;
    Ok(json!({ "status": "closed" }))
}
