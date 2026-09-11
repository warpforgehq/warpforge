use anyhow::{anyhow, Context, Result};

use super::super::{github, linear, RemoteIssue};

/// Fetch a tracker's issues. Pure network: the caller decides which of them are
/// new, because `Store` must not be borrowed across an `.await`.
///
/// Providers that are not connected are skipped rather than failing the import:
/// a project with only GitHub should not error because Linear is absent.
/// `linear_team_id` is the team this project was pointed at. Without it there is
/// nothing to import: a Linear API key sees the whole account, so an unscoped
/// pull adopts the same issues into *every* project the user opens. Skipped and
/// logged, not an error — a GitHub-only project must still import (invariant 8).
pub async fn fetch_importable(
    provider: Option<&str>,
    repo_dir: Option<&str>,
    linear_team_id: Option<&str>,
) -> Result<Vec<(String, Vec<RemoteIssue>)>> {
    let wants = |name: &str| provider.is_none_or(|p| p == name);
    let mut out = Vec::new();

    if wants("github") {
        let dir =
            repo_dir.ok_or_else(|| anyhow!("GitHub import needs a registered git repository"))?;
        let issues = github::github_list_issues(dir, "open")
            .await
            .context("GitHub import failed")?;
        out.push(("github".to_string(), issues));
    }
    if wants("linear") && linear::keychain_read().is_some() {
        match linear_team_id {
            Some(team_id) => {
                let issues = linear::linear_list_issues(team_id)
                    .await
                    .context("Linear import failed")?;
                out.push(("linear".to_string(), issues));
            }
            None => eprintln!("[tracker] skipping Linear import: no team mapped to project"),
        }
    }
    Ok(out)
}
