//! PR creation runs off-loop; successful folder PRs use the keeper ownership path.
use super::super::{Command, Daemon};
use crate::daemon::actor::keepers::KeeperCommand;
use tokio::sync::oneshot;

impl Daemon {
    pub(super) fn create_task_pr(
        &self,
        task_id: String,
        title: String,
        body: String,
        base: Option<String>,
        reply: oneshot::Sender<Result<String, String>>,
    ) {
        let repo = self.tasks.get(&task_id).and_then(|task| {
            task.worktree
                .clone()
                .or_else(|| self.project_path(&task.project))
                .map(|path| (path, task.worktree.is_none()))
        });
        let tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            let result = async {
                let (path, folder) = repo.ok_or_else(|| format!("no repo for task {task_id}"))?;
                let branch = crate::daemon::diff::current_branch(&path).await;
                let url = crate::daemon::diff::create_pr(&path, &title, &body, base.as_deref())
                    .await
                    .map_err(|e| e.to_string())?;
                if let (true, Some(branch)) = (folder, branch) {
                    let (reply, answer) = oneshot::channel();
                    if tx
                        .send(Command::Keepers(KeeperCommand::PrCreated {
                            task_id,
                            branch,
                            reply,
                        }))
                        .await
                        .is_ok()
                    {
                        let _ = answer.await;
                    }
                }
                Ok(url)
            }
            .await;
            let _ = reply.send(result);
        });
    }
}
