//! Canonical JSON (docs/SPEC.md §1): keys sorted, no whitespace, numbers as decimal strings, EVM addresses
//! lowercase. Mirrors `packages/shared/src/canonical.ts` and `scripts/vectors.py`.
use serde_json::Value;
use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub struct CanonicalError(pub &'static str);

impl fmt::Display for CanonicalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for CanonicalError {}

fn is_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_key(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

pub fn canonical_number(n: &serde_json::Number) -> Result<String, CanonicalError> {
    let x = n.as_f64().ok_or(CanonicalError("number must be finite"))?;
    if !x.is_finite() {
        return Err(CanonicalError("number must be finite"));
    }
    if x == 0.0 {
        return Ok("0".into());
    }
    if !(1e-6..1e15).contains(&x.abs()) {
        return Err(CanonicalError("number out of range"));
    }
    if let Some(i) = n.as_i64() {
        return Ok(i.to_string());
    }
    if let Some(u) = n.as_u64() {
        return Ok(u.to_string());
    }
    if x.fract() == 0.0 {
        return Ok((x as i64).to_string());
    }
    // In range, Display prints the shortest round-trip decimal without an exponent, as JS and Python do.
    Ok(format!("{x}"))
}

pub fn canonical_string(s: &str) -> String {
    let lowered;
    let v = if is_address(s) {
        lowered = s.to_ascii_lowercase();
        lowered.as_str()
    } else {
        s
    };
    let mut out = String::with_capacity(v.len() + 2);
    out.push('"');
    for ch in v.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn canonical(v: &Value) -> Result<String, CanonicalError> {
    Ok(match v {
        Value::Null => "null".into(),
        Value::Bool(true) => "true".into(),
        Value::Bool(false) => "false".into(),
        Value::Number(n) => format!("\"{}\"", canonical_number(n)?),
        Value::String(s) => canonical_string(s),
        Value::Array(a) => {
            let parts: Result<Vec<_>, _> = a.iter().map(canonical).collect();
            format!("[{}]", parts?.join(","))
        }
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            if keys.iter().any(|k| !is_key(k)) {
                return Err(CanonicalError("key must match [a-z0-9_]+"));
            }
            keys.sort();
            let mut parts = Vec::with_capacity(keys.len());
            for k in keys {
                parts.push(format!("{}:{}", canonical_string(k), canonical(&o[k])?));
            }
            format!("{{{}}}", parts.join(","))
        }
    })
}
