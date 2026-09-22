use std::path::{Path, PathBuf};

use warpforge_protocol::{AgentAccountLimits, AgentLimitWindow};

/// Legacy per-workspace quota: the `sk-` API key in `auth.json` speaks to the
/// Zen/Go gateway. Still the only path for a key that has a Go plan of its own.
const API_USAGE_URL: &str = "https://opencode.ai/zen/go/v1/usage";
/// What opencode 1.18+ itself uses. Go moved to a Console login (device auth):
/// a session token plus the active org, neither of which is the `sk-` key.
/// A key from one workspace and a subscription on another is exactly how a
/// working CLI produced a 403 here.
const CONSOLE_USAGE_URL: &str = "https://opencode.ai/inference/go/v1/usage";
const TIMEOUT_SECS: u64 = 10;

fn data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("OPENCODE_DATA_DIR") {
        if !d.trim().is_empty() {
            return PathBuf::from(d);
        }
    }
    if let Ok(x) = std::env::var("XDG_DATA_HOME") {
        if !x.trim().is_empty() {
            return PathBuf::from(x).join("opencode");
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local/share/opencode")
}

fn auth_path() -> PathBuf {
    data_dir().join("auth.json")
}

/// opencode's SQLite database. `OPENCODE_DB` is an absolute path when set;
/// a relative one resolves against the data dir, and `:memory:` is not us.
fn db_path() -> PathBuf {
    if let Ok(p) = std::env::var("OPENCODE_DB") {
        let p = p.trim();
        if !p.is_empty() && p != ":memory:" {
            let path = PathBuf::from(p);
            return if path.is_absolute() {
                path
            } else {
                data_dir().join(path)
            };
        }
    }
    data_dir().join("opencode.db")
}

fn read_key() -> Option<(String, String)> {
    let raw = std::fs::read_to_string(auth_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    // key is under "opencode-go" entry
    let entry = v.get("opencode-go")?;
    let key = entry
        .get("key")
        .and_then(|k| k.as_str())
        .or_else(|| entry.get("api_key").and_then(|k| k.as_str()))
        .or_else(|| entry.as_str())?;
    if key.trim().is_empty() {
        return None;
    }
    Some((key.to_string(), raw))
}

/// The Console login opencode actually signs in with: `account.access_token`
/// (`st_…`) for the account `account_state` marks active, plus the org that
/// token is scoped to. Both are required by the inference gateway.
struct Console {
    token: String,
    org_id: String,
    email: String,
}

fn read_console() -> Option<Console> {
    read_console_from(&db_path())
}

fn read_console_from(path: &Path) -> Option<Console> {
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    let (token, email, expiry): (String, String, Option<i64>) = conn
        .query_row(
            "SELECT a.access_token, a.email, a.token_expiry \
             FROM account_state s JOIN account a ON a.id = s.active_account_id \
             LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()?;
    let org_id: String = conn
        .query_row("SELECT active_org_id FROM account_state LIMIT 1", [], |r| {
            r.get(0)
        })
        .ok()?;
    if token.trim().is_empty() || org_id.trim().is_empty() {
        return None;
    }
    // opencode refreshes this token on its own; an expired one here would only
    // buy a 401, so let the API-key path have the poll instead.
    if let Some(exp) = expiry {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as i64;
        if exp > 0 && exp < now_ms {
            return None;
        }
    }
    Some(Console {
        token,
        org_id,
        email,
    })
}

pub fn has_live_login() -> bool {
    read_console().is_some() || read_key().is_some()
}

pub fn live_label() -> String {
    match read_console() {
        Some(c) if !c.email.trim().is_empty() => c.email,
        _ => "Signed in".to_string(),
    }
}

/// A stable name for the current opencode login. The Console account carries
/// an email, so use it; the legacy auth file carries no email, only the API
/// key, so hash that — enough to tell "same login as last launch" from "a
/// different one" without writing the key to another file.
pub fn live_identity() -> Option<String> {
    if let Some(c) = read_console() {
        let email = c.email.trim();
        if !email.is_empty() {
            return Some(format!("opencode-console:{email}"));
        }
    }
    use sha2::{Digest, Sha256};
    let (key, _) = read_key()?;
    let digest = Sha256::digest(key.as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    Some(format!("opencode-key:{hex}"))
}

enum Fetch {
    Body(serde_json::Value),
    Throttled(Option<u64>),
    Failed(String),
}

async fn get_usage(
    client: &reqwest::Client,
    url: &str,
    extra: &[(&str, String)],
    token: &str,
) -> Fetch {
    let mut req = client
        .get(url)
        .header("Authorization", format!("Bearer {token}"));
    for (name, value) in extra {
        req = req.header(*name, value);
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(body) => Fetch::Body(body),
            Err(e) => Fetch::Failed(e.to_string()),
        },
        Ok(r) if r.status().as_u16() == 429 => {
            let ra = r
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.trim().parse::<u64>().ok());
            Fetch::Throttled(ra)
        }
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            Fetch::Failed(failure_message(status, &body))
        }
        Err(e) => Fetch::Failed(e.to_string()),
    }
}

/// Both gateways answer errors as `{"type":"error","error":{"type":…,"message":…}}`.
/// Carry that message — "OpenCode Go subscription required." beats "http 403".
fn failure_message(status: reqwest::StatusCode, body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("http {status}"))
}

fn error_account(
    account_id: &str,
    label: &str,
    fetched_at: i64,
    message: &str,
) -> AgentAccountLimits {
    AgentAccountLimits {
        account_id: account_id.to_string(),
        agent_id: "opencode".into(),
        label: label.to_string(),
        active: true,
        plan: None,
        windows: vec![],
        exhausted: false,
        fetched_at,
        source: "api".into(),
        error: Some(message.to_string()),
    }
}

fn from_body(
    account_id: &str,
    label: &str,
    body: &serde_json::Value,
    fetched_at: i64,
) -> AgentAccountLimits {
    let windows = parse_windows(body);
    let exhausted = windows
        .iter()
        .any(|w: &AgentLimitWindow| w.used_percent >= 100.0);
    AgentAccountLimits {
        account_id: account_id.to_string(),
        agent_id: "opencode".into(),
        label: label.to_string(),
        active: true,
        plan: body
            .get("plan")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        windows,
        exhausted,
        fetched_at,
        source: "api".into(),
        error: None,
    }
}

pub async fn fetch_for_account(
    account_id: &str,
    label: &str,
    fetched_at: i64,
) -> AgentAccountLimits {
    let console = read_console();
    let key = read_key();
    if console.is_none() && key.is_none() {
        return error_account(account_id, label, fetched_at, "not logged in");
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(e) => return error_account(account_id, label, fetched_at, &e.to_string()),
    };
    let mut errors: Vec<String> = Vec::new();
    if let Some(c) = console.as_ref() {
        let extra = [("x-opencode-org-id", c.org_id.clone())];
        match get_usage(&client, CONSOLE_USAGE_URL, &extra, &c.token).await {
            Fetch::Body(body) => return from_body(account_id, label, &body, fetched_at),
            Fetch::Throttled(ra) => {
                super::poll::set_backoff(account_id, fetched_at + ra.unwrap_or(60) as i64);
                return super::shared::throttled_account(
                    "opencode", account_id, label, true, fetched_at,
                );
            }
            Fetch::Failed(e) => errors.push(e),
        }
    }
    if let Some((k, _)) = key {
        match get_usage(&client, API_USAGE_URL, &[], &k).await {
            Fetch::Body(body) => return from_body(account_id, label, &body, fetched_at),
            Fetch::Throttled(ra) => {
                super::poll::set_backoff(account_id, fetched_at + ra.unwrap_or(60) as i64);
                return super::shared::throttled_account(
                    "opencode", account_id, label, true, fetched_at,
                );
            }
            Fetch::Failed(e) => errors.push(e),
        }
    }
    error_account(account_id, label, fetched_at, &errors.join("; "))
}

fn parse_windows(body: &serde_json::Value) -> Vec<AgentLimitWindow> {
    let usage = body.get("usage").unwrap_or(body);
    let mut out = Vec::new();
    for (id, label) in [
        ("rolling", "Session"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
    ] {
        let Some(o) = usage.get(id) else { continue };
        if o.get("status")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s != "ok")
        {
            continue;
        }
        let Some(percent) = o.get("percent").and_then(|v| v.as_f64()) else {
            continue;
        };
        let resets_at = o
            .get("resetsAt")
            .and_then(crate::daemon::limits::shared::parse_resets);
        out.push(AgentLimitWindow {
            id: id.to_string(),
            label: label.to_string(),
            used_percent: percent,
            resets_at,
            window_minutes: None,
        });
    }
    // legacy fallback: windows array
    if out.is_empty() {
        if let Some(arr) = body.get("windows").and_then(|v| v.as_array()) {
            return arr
                .iter()
                .filter_map(|o| {
                    let id = o.get("id").and_then(|v| v.as_str())?.to_string();
                    let label = o
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&id)
                        .to_string();
                    let used = o.get("used_percent").and_then(|v| v.as_f64())?;
                    Some(AgentLimitWindow {
                        id,
                        label,
                        used_percent: used,
                        resets_at: o.get("resets_at").and_then(|v| v.as_i64()),
                        window_minutes: o.get("window_minutes").and_then(|v| v.as_u64()),
                    })
                })
                .collect();
        }
    }
    out
}

#[cfg(test)]
mod tests;
