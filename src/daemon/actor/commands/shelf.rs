use warpforge_protocol as wire;

use crate::daemon::actor::{Command, Daemon};

fn daemon_home() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."))
}

impl Daemon {
    pub(crate) async fn handle_shelf_command(&mut self, cmd: Command) {
        match cmd {
            Command::ShelfList { task_id, reply } => {
                let repo = self.task_repo_path(&task_id);
                let home = daemon_home();
                tokio::spawn(async move {
                    let entries = match repo {
                        Some(p) => crate::daemon::diff::shelf_list(&home, &p).await,
                        None => Vec::new(),
                    };
                    let _ = reply.send(wire::ShelfList { entries });
                });
            }
            Command::ShelfCreate {
                task_id,
                name,
                paths,
                reply,
            } => {
                // Shelving rewrites the worktree — resolve here, run off the
                // loop (ADR 0002).
                let repo = self.task_repo_path(&task_id);
                let home = daemon_home();
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => {
                            crate::daemon::diff::shelf_create(&home, &p, &name, paths.as_deref())
                                .await
                                .map_err(|e| e.to_string())
                        }
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }
            Command::ShelfGet { task_id, id, reply } => {
                let repo = self.task_repo_path(&task_id);
                let home = daemon_home();
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::shelf_get(&home, &p, &id)
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }
            Command::ShelfApply {
                task_id,
                id,
                drop,
                reply,
            } => {
                let repo = self.task_repo_path(&task_id);
                let home = daemon_home();
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::shelf_apply(&home, &p, &id, drop)
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }
            Command::ShelfDrop { task_id, id, reply } => {
                let repo = self.task_repo_path(&task_id);
                let home = daemon_home();
                tokio::spawn(async move {
                    let result = match repo {
                        Some(p) => crate::daemon::diff::shelf_drop(&home, &p, &id)
                            .await
                            .map_err(|e| e.to_string()),
                        None => Err(format!("no repo for task {task_id}")),
                    };
                    let _ = reply.send(result);
                });
            }

            other => self.handle_stash_command(other).await,
        }
    }
}
