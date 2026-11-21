//! The one HTTP path to GitHub: a shared client, the resolved credential, a
//! retry after a 401, and status codes turned into messages a user can act on.

use anyhow::{anyhow, bail, Context, Result};
use reqwest::{header::HeaderMap, Method, RequestBuilder, Response, StatusCode};
use std::sync::OnceLock;

use super::auth::{github_token, invalidate_token, NO_CREDENTIALS};
use super::{GITHUB_API, GITHUB_GRAPHQL};
use crate::daemon::tracker::NETWORK_TIMEOUT;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("warpforge")
            .timeout(NETWORK_TIMEOUT)
            .build()
            .unwrap_or_default()
    })
}

/// Send a request built by `build` with the current token. A 401 drops the
/// token and the request is sent once more with whatever resolves next, so a
/// revoked PAT falls through to the `gh` session without a restart.
async fn send(build: impl Fn(&reqwest::Client) -> RequestBuilder) -> Result<Response> {
    let mut retried = false;
    loop {
        let token = github_token()
            .await
            .ok_or_else(|| anyhow!(NO_CREDENTIALS))?;
        let resp = build(client())
            .bearer_auth(&token)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .context("GitHub request failed")?;
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED && !retried {
            invalidate_token(&token).await;
            retried = true;
            continue;
        }
        if status.is_success() {
            return Ok(resp);
        }
        let headers = resp.headers().clone();
        let body = resp.text().await.unwrap_or_default();
        return Err(status_error(status, &headers, &body));
    }
}

/// A failed response as a sentence: what went wrong and what fixes it.
pub(super) fn status_error(status: StatusCode, headers: &HeaderMap, body: &str) -> anyhow::Error {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.trim().chars().take(200).collect());
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    if let Some(sso) = header("x-github-sso") {
        let url = sso
            .split(';')
            .find_map(|part| part.trim().strip_prefix("url="))
            .unwrap_or("https://github.com/settings/tokens");
        return anyhow!(
            "GitHub requires single sign-on for this organization. Authorize your token at {url}"
        );
    }
    match status.as_u16() {
        401 => anyhow!(
            "GitHub rejected the credentials (401). Reconnect GitHub in Settings or run `gh auth login`."
        ),
        403 | 429 if header("x-ratelimit-remaining") == Some("0") => {
            anyhow!("GitHub rate limit reached. Try again in a few minutes.")
        }
        403 => anyhow!(
            "GitHub denied access (403): {message}. The token needs the `repo` scope for this repository."
        ),
        404 => anyhow!("GitHub could not find it (404): {message}"),
        _ => anyhow!("GitHub request failed ({status}): {message}"),
    }
}

/// A REST call answered with JSON. `path` is relative to `api.github.com`.
pub(super) async fn rest_json(
    method: Method,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Result<serde_json::Value> {
    let url = format!("{GITHUB_API}/{}", path.trim_start_matches('/'));
    let resp = send(|client| {
        let request = client
            .request(method.clone(), &url)
            .header("Accept", "application/vnd.github+json");
        match body {
            Some(body) => request.json(body),
            None => request,
        }
    })
    .await?;
    resp.json().await.context("parsing GitHub response")
}

/// A REST GET with query parameters, answered with JSON.
pub(super) async fn rest_get_query(
    path: &str,
    query: &[(&str, String)],
) -> Result<serde_json::Value> {
    let url = format!("{GITHUB_API}/{}", path.trim_start_matches('/'));
    let resp = send(|client| {
        client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .query(query)
    })
    .await?;
    resp.json().await.context("parsing GitHub response")
}

/// A REST GET answered as text, with the given `Accept` (a diff, say).
pub(super) async fn rest_text(path: &str, accept: &str) -> Result<String> {
    let url = format!("{GITHUB_API}/{}", path.trim_start_matches('/'));
    let resp = send(|client| client.get(&url).header("Accept", accept)).await?;
    resp.text().await.context("reading GitHub response")
}

/// A GraphQL envelope whose `data` may sit beside `errors`.
pub(super) struct Partial {
    pub data: serde_json::Value,
    pub errors: Vec<serde_json::Value>,
}

/// Split an envelope. Errors next to data are kept for the caller to judge;
/// without data there is nothing to keep and the errors are the failure.
pub(super) fn split_envelope(envelope: serde_json::Value) -> Result<Partial> {
    let errors = envelope
        .get("errors")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    match envelope.get("data").filter(|data| !data.is_null()) {
        Some(data) => Ok(Partial {
            data: data.clone(),
            errors,
        }),
        None if errors.is_empty() => bail!("GitHub GraphQL returned no data"),
        None => bail!("GitHub GraphQL error: {}", error_messages(&errors)),
    }
}

pub(super) fn error_messages(errors: &[serde_json::Value]) -> String {
    errors
        .iter()
        .map(|e| {
            e.get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| e.to_string())
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// A GraphQL query that may answer partially. Fails only when no data came back.
pub(super) async fn graphql_partial(query: &str, vars: serde_json::Value) -> Result<Partial> {
    let payload = serde_json::json!({ "query": query, "variables": vars });
    let resp = send(|client| client.post(GITHUB_GRAPHQL).json(&payload)).await?;
    let envelope: serde_json::Value = resp
        .json()
        .await
        .context("parsing GitHub GraphQL response")?;
    split_envelope(envelope)
}

/// A GraphQL query or mutation that must answer whole. Returns the envelope
/// (`{"data": …}`), so callers read the same pointers they always have.
pub(crate) async fn github_graphql(
    query: &str,
    vars: serde_json::Value,
) -> Result<serde_json::Value> {
    let partial = graphql_partial(query, vars).await?;
    if !partial.errors.is_empty() {
        bail!("GitHub GraphQL error: {}", error_messages(&partial.errors));
    }
    Ok(serde_json::json!({ "data": partial.data }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn data_beside_errors_is_kept_and_no_data_is_a_failure() {
        let partial = split_envelope(serde_json::json!({
            "data": { "repository": { "issues": { "nodes": [] } } },
            "errors": [{ "type": "INSUFFICIENT_SCOPES", "message": "needs read:project" }],
        }))
        .unwrap();
        assert!(partial.data.pointer("/repository/issues").is_some());
        assert_eq!(partial.errors.len(), 1);

        let err = split_envelope(serde_json::json!({
            "data": null,
            "errors": [{ "message": "Bad credentials" }],
        }))
        .err()
        .unwrap();
        assert!(format!("{err}").contains("Bad credentials"), "{err}");
    }

    #[test]
    fn statuses_become_sentences_a_user_can_act_on() {
        let none = HeaderMap::new();
        let msg = |status: u16, headers: &HeaderMap| {
            let status = StatusCode::from_u16(status).unwrap();
            status_error(status, headers, r#"{"message":"nope"}"#).to_string()
        };
        assert!(msg(401, &none).contains("gh auth login"));
        assert!(msg(403, &none).contains("`repo` scope"));

        let mut sso = HeaderMap::new();
        sso.insert(
            "x-github-sso",
            HeaderValue::from_static("required; url=https://github.com/orgs/acme/sso?x=1"),
        );
        assert!(msg(403, &sso).contains("https://github.com/orgs/acme/sso?x=1"));

        let mut limited = HeaderMap::new();
        limited.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        assert!(msg(403, &limited).contains("rate limit"));
    }
}
