use std::collections::{BTreeMap, HashMap};

use warpforge_protocol as wire;

use super::super::super::store::TrackerLink;
use super::super::{github, linear, NETWORK_TIMEOUT};

/// Refreshed links with their wire items, and the item ids whose issue is gone.
pub type Refreshed = (Vec<(TrackerLink, wire::SyncedExternalItem)>, Vec<String>);

/// Pull the latest status for a set of links. Network calls run here with no
/// store borrow; the caller persists the results afterwards so the non-`Send`
/// rusqlite connection never crosses an `.await`.
///
/// `repo_dirs` maps a project to its git dir (github links), `linear_teams` a
/// project to its mapped team (linear links).
pub async fn fetch_links_status(
    links: &[TrackerLink],
    repo_dirs: &HashMap<String, String>,
    linear_teams: &HashMap<String, String>,
) -> Refreshed {
    // One listing per repo/team, not one lookup per item (ADR-0002 invariant 3).
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
        match github::github_list_issues(dir).await {
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
        let mut teams: BTreeMap<&String, Vec<&String>> = BTreeMap::new();
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
    let mut missing = Vec::new();
    for link in links {
        match states.get(&(
            link.provider.clone(),
            link.project.clone(),
            link.external_id.clone(),
        )) {
            Some((status, remote_status)) => {
                out.push(refreshed(link, status, remote_status, now));
            }
            None => missing.push(link.clone()),
        }
    }
    let (more, deleted) = resolve_missing(&missing, repo_dirs).await;
    out.extend(more);
    (out, deleted)
}

fn refreshed(
    link: &TrackerLink,
    status: &str,
    remote_status: &str,
    now: u64,
) -> (TrackerLink, wire::SyncedExternalItem) {
    let mut updated = link.clone();
    updated.status = status.to_string();
    updated.remote_status = Some(remote_status.to_string());
    updated.last_synced_at = now;
    let item = wire::SyncedExternalItem {
        id: updated.item_id.clone(),
        url: updated.url.clone(),
        status: updated.status.clone(),
        remote_status: updated.remote_status.clone(),
    };
    (updated, item)
}

/// Links a listing did not cover: refreshed when their issue is still there,
/// reported deleted when the tracker says it is gone. GitHub answers each
/// project's links in batched lookups; Linear per issue, a few at a time.
/// Links with no external id (a task link on a local item) are skipped.
pub async fn resolve_missing(
    links: &[TrackerLink],
    repo_dirs: &HashMap<String, String>,
) -> Refreshed {
    let now = crate::daemon::task::now_secs();
    let mut out = Vec::new();
    let mut deleted = Vec::new();
    let links: Vec<&TrackerLink> = links
        .iter()
        .filter(|link| !link.external_id.is_empty())
        .collect();

    let mut by_project: BTreeMap<&String, Vec<&TrackerLink>> = BTreeMap::new();
    for link in links
        .iter()
        .copied()
        .filter(|link| link.provider == "github")
    {
        by_project.entry(&link.project).or_default().push(link);
    }
    for (project, project_links) in by_project {
        let Some(dir) = repo_dirs.get(project) else {
            continue;
        };
        let ids: Vec<String> = project_links
            .iter()
            .map(|link| link.external_id.clone())
            .collect();
        let states = match github::github_issue_states(dir, &ids).await {
            Ok(states) => states,
            Err(e) => {
                eprintln!("[tracker] github lookup skipped for {project}: {e:#}");
                continue;
            }
        };
        for link in project_links {
            match states.get(&link.external_id) {
                Some(github::IssueState::Found {
                    status,
                    remote_status,
                }) => out.push(refreshed(link, status, remote_status, now)),
                Some(github::IssueState::Deleted) => deleted.push(link.item_id.clone()),
                None => {}
            }
        }
    }

    const CONCURRENCY: usize = 8;
    let linear_links: Vec<&TrackerLink> = links
        .iter()
        .copied()
        .filter(|link| link.provider == "linear")
        .collect();
    for chunk in linear_links.chunks(CONCURRENCY) {
        let checks = chunk.iter().map(|link| async move {
            let gone = tokio::time::timeout(
                NETWORK_TIMEOUT,
                linear::linear_issue_exists(&link.external_id),
            )
            .await
            .ok()
            .flatten()
                == Some(false);
            gone.then(|| link.item_id.clone())
        });
        deleted.extend(
            futures::future::join_all(checks)
                .await
                .into_iter()
                .flatten(),
        );
    }
    (out, deleted)
}
