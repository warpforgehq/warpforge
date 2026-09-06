use warpforge_protocol as wire;

use crate::daemon::actor::{Command, Daemon};

impl Daemon {
    pub(crate) async fn handle_stash_command(&mut self, cmd: Command) {
        match cmd {
            Command::StashPush {
                task_id,
                message,
                paths,
                reply,
            } => {
                let repo = self.task_repo_path(&task_id);
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::stash_push(&p, &message, paths.as_deref())
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }
            Command::StashList { task_id, reply } => {
                let repo = self.task_repo_path(&task_id);
                tokio::spawn(async move {
                    let entries = match repo {
                        Some(p) => crate::daemon::diff::stash_list(&p)
                            .await
                            .unwrap_or_default(),
                        None => Vec::new(),
                    };
                    let _ = reply.send(wire::StashList { entries });
                });
            }
            Command::StashGet { task_id, id, reply } => {
                let repo = self.task_repo_path(&task_id);
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::stash_get(&p, &id)
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }
            Command::StashApply {
                task_id,
                id,
                pop,
                reply,
            } => {
                // Applying rewrites the worktree — resolve here, run off the
                // loop (ADR 0002).
                let repo = self.task_repo_path(&task_id);
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::stash_apply(&p, &id, pop)
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }
            Command::StashFile {
                task_id,
                id,
                paths,
                reply,
            } => {
                let repo = self.task_repo_path(&task_id);
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::stash_checkout_file(&p, &id, &paths)
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }
            Command::StashDrop { task_id, id, reply } => {
                let repo = self.task_repo_path(&task_id);
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::stash_drop(&p, &id)
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }

            other => self.handle_files_command(other).await,
        }
    }
}
