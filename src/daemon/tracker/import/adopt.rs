use anyhow::Result;

use warpforge_protocol as wire;

use super::super::super::store::{Store, TrackerLink};
use super::super::{make_link, RemoteIssue};

/// Turn freshly-fetched issues into backlog items, skipping any whose external
/// id is already linked for *this project*.
///
/// Deduplication is scoped by `(provider, project, external_id)`: the same
/// GitHub issue number exists in two different repos a user tracks, and one
/// project's imported issue must never be suppressed because a *different*
/// project already linked the same external id.
///
/// `yaml_project_path` is the project's checkout directory when the configured
/// backlog backend is YAML files. Backlog item rows then land in
/// `…/.warpforge/backlog/*.yaml` (project-local) instead of the SQLite
/// `backlog_items` table; tracker links always live in SQLite because they are
/// daemon-owned. Passing `None` persists to SQLite.
pub fn adopt_imported(
    store: &Store,
    project: &str,
    yaml_project_path: Option<&str>,
    fetched: Vec<(String, Vec<RemoteIssue>)>,
) -> Result<(Vec<wire::ImportedWorkItem>, Vec<wire::SyncedExternalItem>)> {
    // The same listing answers both questions, so one pass does both: an issue
    // we have never seen becomes a new item, and one we already track has its
    // status refreshed. Running import and sync as separate fetches doubled the
    // network work on every project open for no extra information.
    let known: std::collections::HashMap<(String, String, String), TrackerLink> = store
        .load_all_tracker_links()?
        .into_iter()
        .map(|link| {
            (
                (
                    link.provider.clone(),
                    link.project.clone(),
                    link.external_id.clone(),
                ),
                link,
            )
        })
        .collect();

    // A project-local item read that respects the configured backend so a YAML
    // mode never reads (or writes) the SQLite `backlog_items` shadow rows.
    let load_item = |item_id: &str| -> Result<Option<wire::BacklogItem>> {
        if let Some(dir) = yaml_project_path {
            crate::daemon::backlog::read(dir, project, item_id)
        } else {
            store.get_backlog_item(item_id)
        }
    };
    let write_item = |item: &wire::BacklogItem| -> Result<()> {
        if let Some(dir) = yaml_project_path {
            crate::daemon::backlog::write(dir, item)
        } else {
            store.upsert_backlog_item(item)
        }
    };
    // The row mirrors the issue, so it carries the *tracker's* timestamps, not
    // the moment this sync ran: stamping `now` here made every synced item look
    // freshly touched and re-sorted the board on each refresh. The assignee is
    // the tracker's to answer for too, and rows imported before it was asked
    // for have none.
    let update_remote = |item_id: &str, issue: &RemoteIssue| {
        let created_at = issue.created_or_updated();
        if let Some(dir) = yaml_project_path {
            crate::daemon::backlog::update(dir, project, item_id, |item| {
                item.status = issue.status.clone();
                item.remote_status = Some(issue.remote_status.clone());
                item.url = Some(issue.url.clone());
                item.assignee = issue.assignee.clone();
                item.created_at = created_at;
                item.updated_at = issue.updated_at;
            })
        } else {
            store.update_backlog_remote(
                item_id,
                &issue.status,
                Some(issue.remote_status.as_str()),
                &issue.url,
                issue.updated_at,
            )?;
            store.set_backlog_created_at(item_id, created_at)?;
            store.set_backlog_assignee(item_id, issue.assignee.as_deref())
        }
    };

    let now = crate::daemon::task::now_secs();
    let mut imported = Vec::new();
    let mut next_number = store.next_backlog_number(project)?;
    let mut synced = Vec::new();
    for (provider, issues) in fetched {
        for issue in issues {
            let key = (
                provider.clone(),
                project.to_string(),
                issue.external_id.clone(),
            );
            if let Some(existing) = known.get(&key) {
                let stored = load_item(&existing.item_id)?;
                if stored.is_none() {
                    let item = wire::BacklogItem {
                        id: existing.item_id.clone(),
                        number: next_number,
                        project: project.to_string(),
                        title: issue.title.clone(),
                        body: issue.body.clone(),
                        status: issue.status.clone(),
                        priority: "none".into(),
                        source: provider.clone(),
                        external_id: Some(issue.external_id.clone()),
                        url: Some(issue.url.clone()),
                        remote_status: Some(issue.remote_status.clone()),
                        assignee: issue.assignee.clone(),
                        created_at: issue.created_or_updated(),
                        updated_at: issue.updated_at,
                        task_id: existing.task_id.clone(),
                    };
                    write_item(&item)?;
                    imported.push(wire::ImportedWorkItem {
                        item_id: item.id,
                        number: item.number,
                        provider: provider.clone(),
                        project: item.project,
                        external_id: issue.external_id,
                        url: issue.url,
                        title: issue.title,
                        body: issue.body,
                        status: issue.status,
                        remote_status: Some(issue.remote_status),
                        assignee: issue.assignee,
                        updated_at: issue.updated_at,
                    });
                    next_number += 1;
                    continue;
                }
                let status_moved = existing.status != issue.status
                    || existing.remote_status.as_deref() != Some(issue.remote_status.as_str());
                // Rows imported before the tracker's own timestamps were read
                // stored the fetch time as their creation time, so "Created"
                // and "Updated" always read the same; rows imported before the
                // assignee was asked for have none. Repair them in place rather
                // than asking anyone to re-import.
                let mirror_stale = stored.is_some_and(|item| {
                    item.created_at != issue.created_or_updated()
                        || item.updated_at != issue.updated_at
                        || item.assignee != issue.assignee
                });
                if !status_moved && !mirror_stale {
                    continue;
                }
                if !status_moved {
                    update_remote(&existing.item_id, &issue)?;
                    continue;
                }
                let mut link = existing.clone();
                link.status = issue.status.clone();
                link.remote_status = Some(issue.remote_status.clone());
                link.last_synced_at = now;
                store.upsert_tracker_link(&link)?;
                update_remote(&link.item_id, &issue)?;
                synced.push(wire::SyncedExternalItem {
                    id: link.item_id,
                    url: link.url,
                    status: issue.status,
                    remote_status: link.remote_status,
                });
                continue;
            }
            let item_id = uuid::Uuid::new_v4().to_string();
            let mut link = make_link(
                &item_id,
                &provider,
                project,
                &issue.external_id,
                &issue.url,
                true,
            );
            link.status = issue.status.clone();
            link.remote_status = Some(issue.remote_status.clone());
            link.last_synced_at = now;
            store.upsert_tracker_link(&link)?;
            write_item(&wire::BacklogItem {
                id: item_id.clone(),
                number: next_number,
                project: project.to_string(),
                title: issue.title.clone(),
                body: issue.body.clone(),
                status: issue.status.clone(),
                priority: "none".into(),
                source: provider.clone(),
                external_id: Some(issue.external_id.clone()),
                url: Some(issue.url.clone()),
                remote_status: Some(issue.remote_status.clone()),
                assignee: issue.assignee.clone(),
                created_at: issue.created_or_updated(),
                updated_at: issue.updated_at,
                task_id: None,
            })?;
            imported.push(wire::ImportedWorkItem {
                item_id,
                number: next_number,
                provider: provider.clone(),
                project: project.to_string(),
                external_id: issue.external_id,
                url: issue.url,
                title: issue.title,
                body: issue.body,
                status: issue.status,
                remote_status: Some(issue.remote_status),
                assignee: issue.assignee.clone(),
                updated_at: issue.updated_at,
            });
            next_number += 1;
        }
    }
    Ok((imported, synced))
}
