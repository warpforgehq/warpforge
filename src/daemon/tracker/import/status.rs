use warpforge_protocol as wire;

use super::super::super::store::TrackerLink;
use super::super::{github, linear, NETWORK_TIMEOUT};

/// Refreshed links with their wire items, and the item ids whose issue is gone.
pub type Refreshed = (Vec<(TrackerLink, wire::SyncedExternalItem)>, Vec<String>);

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
/// reported deleted when the tracker says it is gone. GitHub answers the
/// project's links in batched lookups; Linear per issue, a few at a time.
/// Links with no external id (a task link on a local item) are skipped.
pub async fn resolve_missing(links: &[TrackerLink], repo_dir: Option<&str>) -> Refreshed {
    let now = crate::daemon::task::now_secs();
    let mut out = Vec::new();
    let mut deleted = Vec::new();
    let links: Vec<&TrackerLink> = links
        .iter()
        .filter(|link| !link.external_id.is_empty())
        .collect();

    let github_links: Vec<&TrackerLink> = links
        .iter()
        .copied()
        .filter(|link| link.provider == "github")
        .collect();
    if let Some(dir) = repo_dir.filter(|_| !github_links.is_empty()) {
        let ids: Vec<String> = github_links
            .iter()
            .map(|link| link.external_id.clone())
            .collect();
        match github::github_issue_states(dir, &ids).await {
            Ok(states) => {
                for link in github_links {
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
            Err(e) => eprintln!("[tracker] github lookup skipped: {e:#}"),
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
