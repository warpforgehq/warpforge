use warpforge_protocol as wire;

use super::super::super::store::TrackerLink;
use super::super::{github, linear, NETWORK_TIMEOUT};

/// Pull the latest status for a set of links. Returns the updated links (with
/// fresh status) plus their wire items. Network calls run here with no store
/// borrow; the caller persists the results afterwards so the non-`Send`
/// rusqlite connection never crosses an `.await`.
///
/// `repo_dir_for` resolves a project name to its git dir (used by github links
/// only).
pub async fn fetch_links_status(
    links: &[TrackerLink],
    repo_dirs: &std::collections::HashMap<String, String>,
    linear_teams: &std::collections::HashMap<String, String>,
) -> (Vec<(TrackerLink, wire::SyncedExternalItem)>, Vec<String>) {
    use std::collections::HashMap;

    // One listing per repo/team, not one lookup per item. The per-item path
    // cost two `gh` spawns each (resolve owner/repo, then read the issue), so a
    // twenty-item board meant forty subprocesses in a row.
    let mut states: HashMap<(String, String, String), (String, String)> = HashMap::new();

    let github_projects: std::collections::BTreeSet<&String> = links
        .iter()
        .filter(|link| link.provider == "github")
        .map(|link| &link.project)
        .collect();
    for project in github_projects {
        let Some(dir) = repo_dirs.get(project) else {
            continue;
        };
        match github::github_list_issues(dir, "all").await {
            Ok(issues) => {
                for issue in issues {
                    states.insert(
                        ("github".to_string(), project.clone(), issue.external_id),
                        (issue.status, issue.remote_status),
                    );
                }
            }
            Err(e) => eprintln!("[tracker] github sync skipped for {project}: {e:#}"),
        }
    }

    if links.iter().any(|link| link.provider == "linear") {
        // One listing per mapped team, not per link. Projects sharing a team
        // share its listing; a project with no team mapped has no Linear rows to
        // refresh, so it is simply absent here.
        let mut teams: std::collections::BTreeMap<&String, Vec<&String>> =
            std::collections::BTreeMap::new();
        for link in links.iter().filter(|link| link.provider == "linear") {
            if let Some(team_id) = linear_teams.get(&link.project) {
                teams.entry(team_id).or_default().push(&link.project);
            }
        }
        for (team_id, projects) in teams {
            match linear::linear_list_issues(team_id).await {
                Ok(issues) => {
                    for issue in issues {
                        for project in &projects {
                            states.insert(
                                (
                                    "linear".to_string(),
                                    (*project).clone(),
                                    issue.external_id.clone(),
                                ),
                                (issue.status.clone(), issue.remote_status.clone()),
                            );
                        }
                    }
                }
                Err(e) => eprintln!("[tracker] linear sync skipped for team {team_id}: {e:#}"),
            }
        }
    }

    let now = crate::daemon::task::now_secs();
    let mut out = Vec::new();
    // Collect missing links to check concurrently — sequential `gh issue view` per item
    // blocked the daemon RPC (user saw infinite spinner, whole daemon unresponsive).
    let missing: Vec<&TrackerLink> = links
        .iter()
        .filter(|link| {
            !states.contains_key(&(
                link.provider.clone(),
                link.project.clone(),
                link.external_id.clone(),
            ))
        })
        .collect();

    let deleted: Vec<String> = if missing.is_empty() {
        Vec::new()
    } else {
        // Cap concurrency to avoid spawning 100 gh processes at once.
        const CONCURRENCY: usize = 8;
        let mut deleted = Vec::new();
        for chunk in missing.chunks(CONCURRENCY) {
            let checks = chunk.iter().map(|link| {
                let dir = repo_dirs.get(&link.project).cloned();
                let ext = link.external_id.clone();
                let provider = link.provider.clone();
                let item_id = link.item_id.clone();
                async move {
                    let is_deleted = if provider == "github" {
                        if let Some(d) = dir {
                            // Bound per-check to NETWORK_TIMEOUT so one hung `gh` doesn't stall sync forever.
                            tokio::time::timeout(
                                NETWORK_TIMEOUT,
                                github::github_issue_exists(&d, &ext),
                            )
                            .await
                            .ok()
                            .flatten()
                                == Some(false)
                        } else {
                            false
                        }
                    } else if provider == "linear" {
                        tokio::time::timeout(NETWORK_TIMEOUT, linear::linear_issue_exists(&ext))
                            .await
                            .ok()
                            .flatten()
                            == Some(false)
                    } else {
                        false
                    };
                    is_deleted.then_some(item_id)
                }
            });
            let results = futures::future::join_all(checks).await;
            deleted.extend(results.into_iter().flatten());
        }
        deleted
    };

    for link in links {
        let Some((status, remote_status)) = states.get(&(
            link.provider.clone(),
            link.project.clone(),
            link.external_id.clone(),
        )) else {
            continue;
        };
        let mut updated = link.clone();
        updated.status = status.clone();
        updated.remote_status = Some(remote_status.clone());
        updated.last_synced_at = now;
        let item = wire::SyncedExternalItem {
            id: updated.item_id.clone(),
            url: updated.url.clone(),
            status: updated.status.clone(),
            remote_status: updated.remote_status.clone(),
        };
        out.push((updated, item));
    }
    (out, deleted)
}
