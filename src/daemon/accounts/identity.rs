/// Display identity of an account, read out of its vault. Never includes a
/// token: only what the switcher shows.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AccountIdentity {
    pub email: Option<String>,
    pub plan: Option<String>,
}

/// Decode the claims of a JWT without verifying its signature. The token comes
/// from a local file we already trust; we only want the account label out of
/// it. Returns `None` for anything that is not a three-part JWT.
pub fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Identity of a Codex account from its `auth.json` contents: the email and
/// plan carried in the `id_token` claims.
pub fn codex_identity(auth_json: &str) -> AccountIdentity {
    let Ok(auth) = serde_json::from_str::<serde_json::Value>(auth_json) else {
        return AccountIdentity::default();
    };
    let Some(claims) = auth
        .get("tokens")
        .and_then(|t| t.get("id_token"))
        .and_then(|t| t.as_str())
        .and_then(jwt_claims)
    else {
        return AccountIdentity::default();
    };
    AccountIdentity {
        email: claims
            .get("email")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        plan: claims
            .get("https://api.openai.com/auth")
            .and_then(|v| v.get("chatgpt_plan_type"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    }
}

/// Identity of a Claude account from a `.claude.json` (or our stored
/// `oauth-account.json`) blob.
pub fn claude_identity(config_json: &str) -> AccountIdentity {
    let Ok(config) = serde_json::from_str::<serde_json::Value>(config_json) else {
        return AccountIdentity::default();
    };
    let account = config.get("oauthAccount").unwrap_or(&config);
    AccountIdentity {
        email: account
            .get("emailAddress")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        plan: account
            .get("seatTier")
            .or_else(|| account.get("billingType"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    }
}
