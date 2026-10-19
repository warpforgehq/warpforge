//! Smiths (ADR 0027): the actor's authoritative mirror of every Smith, and
//! the one exhaustive match over `SmithCommand`. Identity files are written
//! off the loop (`daemon/smiths/identity.rs`); results come back as commands.

mod assign;
mod budget;
mod command;
mod directory;
mod journal;
mod manage;
mod permissions;
pub(crate) mod prompt;
mod report;
mod session;
#[cfg(test)]
mod tests;
mod work;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use warpforge_protocol as wire;

use crate::daemon::actor::{Daemon, Event};
use crate::daemon::runtime::Write as PersistWrite;
use crate::daemon::smiths::identity::{self, Revs};
use crate::daemon::store::Store;

pub use command::SmithCommand;

/// `origin` of a Smith's thread task.
pub(crate) const SMITH_ORIGIN: &str = "smith";

pub(crate) struct SmithsState {
    /// Where identity repos live: `~/.warpforge/smiths` outside tests.
    root: PathBuf,
    smiths: HashMap<String, wire::Smith>,
    /// Lowercased names claimed by a create still writing its repo.
    pending_names: HashSet<String>,
    /// Smiths whose identity repo has a write in flight.
    busy: HashSet<String>,
    /// Each Smith's soul as last committed, for prompts built on the loop.
    souls: HashMap<String, String>,
    /// The installed Claude adapter reads `_meta.systemPrompt` (checked once
    /// at startup); otherwise the soul goes as an opening prefix.
    claude_meta: bool,
    /// Turns and spend per Smith over the last day, for the daily budget.
    spend: budget::Spend,
    /// `start_work` sessions that messaged their asker in the running turn,
    /// whose turn-close report would repeat it.
    messaged_asker: HashSet<String>,
}

/// The identity revs a Smith row records.
fn recorded(smith: &wire::Smith) -> Revs {
    Revs {
        soul: smith.soul_rev.clone(),
        charter: smith.charter_rev.clone(),
    }
}

/// Read the Smiths and their souls once at startup. The git check for an
/// outside edit runs off the loop, on the first tick right after spawn.
/// @param store the daemon's store, when it opened
/// @param root the smiths root
/// @returns the mirror the actor starts with
pub(crate) fn load_state(store: Option<&Arc<Mutex<Store>>>, root: PathBuf) -> SmithsState {
    let rows = match store.map(|s| s.lock()) {
        Some(Ok(store)) => store.load_smiths().unwrap_or_default(),
        _ => Vec::new(),
    };
    let mut souls = HashMap::new();
    let smiths = rows
        .into_iter()
        .map(|smith| {
            let dir = identity::repo(&root, &smith.id);
            if let Ok(files) = identity::read(&dir) {
                souls.insert(smith.id.clone(), files.soul);
            }
            (smith.id.clone(), smith)
        })
        .collect();
    SmithsState {
        root,
        smiths,
        pending_names: HashSet::new(),
        busy: HashSet::new(),
        souls,
        claude_meta: !cfg!(test) && crate::daemon::smiths::claude_adapter_reads_meta(),
        spend: Default::default(),
        messaged_asker: HashSet::new(),
    }
}

/// The root a daemon keeps identity repos in. Test builds get a fresh one
/// per daemon, so `cargo test` never touches the user's Smiths.
pub(crate) fn default_root() -> PathBuf {
    if cfg!(test) {
        std::env::temp_dir().join(format!(
            "wf-smiths-test-{}",
            &uuid::Uuid::new_v4().to_string()[..8]
        ))
    } else {
        crate::registry::warpforge_dir().join("smiths")
    }
}

/// Add or lift one hold, keeping the list sorted and unique.
fn set_hold(smith: &mut wire::Smith, hold: wire::SmithHold, on: bool) {
    smith.held.retain(|h| *h != hold);
    if on {
        smith.held.push(hold);
        smith.held.sort();
    }
}

impl Daemon {
    pub(crate) async fn handle_smith_command(&mut self, cmd: SmithCommand) {
        match cmd {
            SmithCommand::List { reply } => {
                let mut smiths: Vec<wire::Smith> = self
                    .smiths
                    .smiths
                    .values()
                    .map(|smith| self.smith_view(smith.clone()))
                    .collect();
                smiths.sort_by_key(|smith| smith.name.to_lowercase());
                let _ = reply.send(Ok(smiths));
            }
            SmithCommand::Get { id, reply } => self.smith_get(&id, reply),
            SmithCommand::Create { create, reply } => self.smith_create(*create, reply),
            SmithCommand::Update { id, patch, reply } => self.smith_update(&id, *patch, reply),
            SmithCommand::SetPaused { id, paused, reply } => {
                let _ = reply.send(self.smith_set_paused(&id, paused));
            }
            SmithCommand::Delete { id, reply } => {
                let _ = reply.send(self.smith_delete(&id));
            }
            SmithCommand::AcceptIdentity { id, reply } => {
                self.smith_resolve_identity(&id, true, reply)
            }
            SmithCommand::RevertIdentity { id, reply } => {
                self.smith_resolve_identity(&id, false, reply)
            }
            SmithCommand::StartWork {
                id,
                project,
                brief,
                backlog_item_id,
                worktree,
                orchestrator,
                reply,
            } => {
                let start = work::WorkStart {
                    backlog_item_id,
                    worktree,
                    orchestrator,
                };
                let result = self.smith_start_work(&id, &project, brief, start).await;
                let _ = reply.send(result);
            }
            SmithCommand::StartWorkFrom {
                from,
                target,
                project,
                brief,
                backlog_item_id,
                worktree,
                reply,
            } => {
                let result = self
                    .smith_start_work_from(
                        &from,
                        &target,
                        &project,
                        brief,
                        backlog_item_id,
                        worktree,
                    )
                    .await;
                let _ = reply.send(result);
            }
            SmithCommand::Tick => self.smith_check_identities(),
            SmithCommand::IdentityChecked { changed } => self.smith_identities_checked(changed),
            #[cfg(test)]
            SmithCommand::UseMemory { path } => {
                if let Ok(memory) = crate::daemon::memory::MemoryStore::open_at(&path) {
                    self.memory = memory;
                }
            }
            #[cfg(test)]
            SmithCommand::SetClaudeMeta { on } => self.smiths.claude_meta = on,
            SmithCommand::Created {
                smith,
                result,
                reply,
            } => self.smith_created(*smith, result, reply),
            SmithCommand::IdentityWritten {
                id,
                result,
                patch,
                reply,
            } => self.smith_identity_written(&id, result, patch.map(|p| *p), reply),
        }
    }

    /// The Smith as clients see it: with how its next session will be given
    /// its identity. Read from the configured agent only, never a file.
    pub(crate) fn smith_view(&self, mut smith: wire::Smith) -> wire::Smith {
        let command = self
            .configured_agents
            .iter()
            .find(|a| a.id == smith.agent || a.display_name == smith.agent)
            .map_or(smith.agent.as_str(), |a| a.acp_command.as_str());
        let meta = self.smiths.claude_meta && session::is_claude_adapter(command);
        smith.injection = Some(if meta {
            wire::SmithInjection::SystemPrompt
        } else {
            wire::SmithInjection::Prefix
        });
        smith
    }

    /// Mirror first, then the store queue, then the event (ADR 0007).
    fn smith_put(&mut self, smith: wire::Smith) {
        let smith = self.smith_view(smith);
        self.persist
            .write(PersistWrite::Smith(Box::new(smith.clone())));
        self.emit(Event::SmithUpdated(Box::new(smith.clone())));
        self.smiths.smiths.insert(smith.id.clone(), smith);
    }

    /// Compare every Smith's identity repo with its recorded revs off the
    /// loop. Smiths with a write in flight are skipped: their revs are moving.
    fn smith_check_identities(&self) {
        let root = self.smiths.root.clone();
        let expected: Vec<(String, Revs)> = self
            .smiths
            .smiths
            .values()
            .filter(|smith| !self.smiths.busy.contains(&smith.id))
            .filter(|smith| !smith.held.contains(&wire::SmithHold::IdentityChanged))
            .map(|smith| (smith.id.clone(), recorded(smith)))
            .collect();
        if expected.is_empty() {
            return;
        }
        let tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            let changed = tokio::task::spawn_blocking(move || {
                expected
                    .into_iter()
                    .filter(
                        |(id, revs)| match identity::check(&identity::repo(&root, id), revs) {
                            identity::IdentityState::Changed => true,
                            identity::IdentityState::Unchanged => false,
                            identity::IdentityState::Unknown(why) => {
                                eprintln!("[daemon] cannot check Smith {id}'s identity: {why}");
                                false
                            }
                        },
                    )
                    .collect::<Vec<_>>()
            })
            .await
            .unwrap_or_default();
            if !changed.is_empty() {
                let _ = tx
                    .send(crate::daemon::actor::Command::Smiths(
                        SmithCommand::IdentityChecked { changed },
                    ))
                    .await;
            }
        });
    }

    /// Hold each Smith whose files changed, unless an edit of ours landed
    /// since the check began: then the revs it was checked against are stale.
    fn smith_identities_checked(&mut self, changed: Vec<(String, Revs)>) {
        for (id, checked) in changed {
            if self.smiths.busy.contains(&id) {
                continue;
            }
            let Some(mut smith) = self.smiths.smiths.get(&id).cloned() else {
                continue;
            };
            if recorded(&smith) != checked || smith.held.contains(&wire::SmithHold::IdentityChanged)
            {
                continue;
            }
            set_hold(&mut smith, wire::SmithHold::IdentityChanged, true);
            self.smith_put(smith);
        }
    }

    /// @param task_id a task
    /// @returns whether it is a Smith's thread
    pub(crate) fn is_smith_thread(&self, task_id: &str) -> bool {
        self.tasks
            .get(task_id)
            .is_some_and(|task| task.origin.as_deref() == Some(SMITH_ORIGIN))
    }

    /// The Smith whose thread is `task_id`.
    pub(crate) fn smith_of_thread(&self, task_id: &str) -> Option<&wire::Smith> {
        self.smiths
            .smiths
            .values()
            .find(|smith| smith.thread_task_id == task_id)
    }
}
