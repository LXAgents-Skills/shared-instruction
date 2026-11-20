//! Bearer-token authentication for the HTTP transport.
//!
//! **Where the server can be reached decides whether a token is needed.** stdio is a pipe that a
//! client spawns on its own machine, so whoever can use it already runs the process. HTTP bound
//! to a loopback address is the same local install over a socket: only this machine can open it,
//! so a token is optional there. HTTP bound to any other address is a server anyone who can
//! reach the port can open, so every request must prove the caller holds the token, and the
//! server refuses to run without one.
//!
//! Every function here is pure: the token is read from the environment once, at the HTTP entry
//! point, and passed in.

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// The shortest token the server will accept, in characters.
///
/// The token is the only thing between a network and this server, so a value like `test` is
/// refused at startup instead of being found by a scanner. 32 characters is what
/// `openssl rand -hex 16` produces; the documented command produces 64.
pub const MIN_TOKEN_LENGTH: usize = 32;

/// Whether `host` is a loopback address, so a socket bound to it is reachable only from this
/// machine: `localhost`, any `127.x.x.x`, or `::1` (bracketed or not).
///
/// `0.0.0.0` and `::` are not loopback — they bind every interface — and neither is a hostname
/// that merely resolves to loopback today.
pub fn is_loopback_host(host: &str) -> bool {
    let lowered = host.trim().to_lowercase();
    let value = lowered
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(&lowered);
    value == "localhost" || value == "::1" || is_127_address(value)
}

/// `127.d.d.d`, each of the last three one to three digits.
fn is_127_address(value: &str) -> bool {
    let mut parts = value.split('.');
    parts.next() == Some("127")
        && parts.clone().count() == 3
        && parts
            .all(|part| (1..=3).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit()))
}

/// The configured token from the raw `MCP_AUTH_TOKEN` value: empty when unset, and with
/// surrounding whitespace dropped, because a token copied out of a file or an `env_file` often
/// carries a trailing newline and an HTTP header cannot.
pub fn configured_token(raw: Option<&str>) -> String {
    raw.unwrap_or_default().trim().to_string()
}

/// Why `token` cannot be used, or `None` when it can. Names the variable, never the value.
pub fn token_problem(token: &str) -> Option<String> {
    let length = token.chars().count();
    if length == 0 {
        return Some("MCP_AUTH_TOKEN is not set".into());
    }
    if length < MIN_TOKEN_LENGTH {
        return Some(format!(
            "MCP_AUTH_TOKEN is {length} characters, and it must be at least {MIN_TOKEN_LENGTH}"
        ));
    }
    None
}

/// Why HTTP bound to `host` cannot start with `token`, or `None` when it can.
///
/// Off loopback a usable token is required. On loopback none is needed, but a token that was set
/// is still checked: setting one is asking for it.
pub fn startup_token_problem(host: &str, token: &str) -> Option<String> {
    if token.is_empty() && is_loopback_host(host) {
        return None;
    }
    token_problem(token)
}

/// The credential in an `Authorization: Bearer <credential>` header, or `None`.
///
/// The scheme is case-insensitive (RFC 7235). Anything else — another scheme, no credential, two
/// of them — is not a bearer credential.
pub fn bearer_credential(header: &str) -> Option<&str> {
    let scheme = header.get(..6)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let rest = &header[6..];
    let credential = rest.trim_start_matches(' ');
    let one_token = !credential.is_empty() && !credential.chars().any(char::is_whitespace);
    (rest.starts_with(' ') && one_token).then_some(credential)
}

/// Why a request was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// No bearer credential was sent.
    Missing,
    /// A credential was sent and it is not the token.
    Invalid,
}

impl Refusal {
    /// The `WWW-Authenticate` challenge for this refusal.
    pub fn challenge(self) -> &'static str {
        match self {
            Refusal::Missing => "Bearer realm=\"mcp\"",
            Refusal::Invalid => "Bearer realm=\"mcp\", error=\"invalid_token\"",
        }
    }

    /// The JSON-RPC error message. Neither reveals anything about the token.
    pub fn message(self) -> &'static str {
        match self {
            Refusal::Missing => "Unauthorized: send the token as Authorization: Bearer <token>",
            Refusal::Invalid => "Unauthorized: the token is not valid",
        }
    }
}

/// The check every guarded request goes through.
///
/// The comparison is constant-time over fixed-length SHA-256 digests, so neither the token's
/// length nor how much of it a guess got right shows in how long the answer takes.
#[derive(Clone)]
pub struct TokenCheck {
    expected: [u8; 32],
}

impl TokenCheck {
    /// A check for `token`, which must already have passed [`token_problem`].
    pub fn new(token: &str) -> Self {
        Self {
            expected: digest(token),
        }
    }

    /// Let a request with this `Authorization` header through, or say why not.
    pub fn verify(&self, authorization: Option<&str>) -> Result<(), Refusal> {
        let credential = authorization
            .and_then(bearer_credential)
            .ok_or(Refusal::Missing)?;
        if bool::from(digest(credential).ct_eq(&self.expected)) {
            Ok(())
        } else {
            Err(Refusal::Invalid)
        }
    }
}

fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "test-token-0123456789abcdef0123456789abcdef";

    #[test]
    fn loopback_hosts() {
        for host in [
            "127.0.0.1",
            "127.1.2.3",
            "localhost",
            "LOCALHOST",
            "::1",
            "[::1]",
        ] {
            assert!(is_loopback_host(host), "{host}");
        }
        for host in [
            "0.0.0.0",
            "::",
            "",
            "10.0.0.1",
            "example.com",
            "127.0.0.1.example.com",
            "128.0.0.1",
            "127.0.0.1234",
        ] {
            assert!(!is_loopback_host(host), "{host}");
        }
    }

    #[test]
    fn startup_problems() {
        assert_eq!(startup_token_problem("127.0.0.1", ""), None);
        assert!(
            startup_token_problem("127.0.0.1", "short")
                .unwrap()
                .contains("must be at least 32")
        );
        assert_eq!(startup_token_problem("127.0.0.1", TOKEN), None);
        assert_eq!(
            startup_token_problem("0.0.0.0", "").as_deref(),
            Some("MCP_AUTH_TOKEN is not set")
        );
        assert_eq!(startup_token_problem("0.0.0.0", TOKEN), None);
    }

    #[test]
    fn token_problems_and_the_configured_token() {
        assert_eq!(
            token_problem("").as_deref(),
            Some("MCP_AUTH_TOKEN is not set")
        );
        assert!(
            token_problem(&"k".repeat(31))
                .unwrap()
                .contains("is 31 characters, and it must be at least 32")
        );
        assert_eq!(token_problem(&"k".repeat(32)), None);
        assert_eq!(configured_token(Some(&format!("  {TOKEN}\r\n"))), TOKEN);
        assert_eq!(configured_token(None), "");
    }

    #[test]
    fn only_one_bearer_credential_counts() {
        assert_eq!(bearer_credential(&format!("Bearer {TOKEN}")), Some(TOKEN));
        assert_eq!(bearer_credential(&format!("bearer   {TOKEN}")), Some(TOKEN));
        for header in [
            format!("Basic {TOKEN}"),
            "Bearer".into(),
            "Bearer ".into(),
            format!("Bearer {TOKEN} {TOKEN}"),
            TOKEN.into(),
            format!("Bearer\t{TOKEN}"),
        ] {
            assert_eq!(bearer_credential(&header), None, "{header}");
        }
    }

    #[test]
    fn the_check_tells_missing_from_wrong() {
        let check = TokenCheck::new(TOKEN);
        assert_eq!(check.verify(Some(&format!("Bearer {TOKEN}"))), Ok(()));
        assert_eq!(check.verify(None), Err(Refusal::Missing));
        assert_eq!(check.verify(Some("Bearer nope")), Err(Refusal::Invalid));
        assert_eq!(
            check.verify(Some(&format!("Bearer {TOKEN}0"))),
            Err(Refusal::Invalid)
        );
    }
}
