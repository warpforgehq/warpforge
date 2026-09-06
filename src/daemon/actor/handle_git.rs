use anyhow::Result;
use tokio::sync::oneshot;

use warpforge_protocol as wire;

use crate::daemon::actor::event::op_result_or_dropped;
use crate::daemon::actor::{Command, DaemonHandle};

impl DaemonHandle {
    pub async fn git_last_commit_message(&self, task_id: &str) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitLastCommitMessage {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon stopped".into()))
    }

    pub async fn git_commit(
        &self,
        task_id: &str,
        message: &str,
        files: Option<Vec<String>>,
        amend: bool,
        project: Option<String>,
    ) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitCommit {
            task_id: task_id.to_string(),
            message: message.to_string(),
            files,
            amend,
            project,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the commit request".into()))
    }

    pub async fn git_update(&self, task_id: &str) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitUpdate {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| wire::GitOpResult {
            status: wire::GitOpStatus::Error,
            message: "daemon dropped the update request".into(),
            conflicts: Vec::new(),
            branch: None,
        })
    }

    pub async fn git_branches(
        &self,
        task_id: Option<String>,
        project: Option<String>,
    ) -> wire::GitBranchList {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitBranches {
            task_id,
            project,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn git_roots(
        &self,
        task_id: Option<String>,
        project: Option<String>,
    ) -> wire::GitRoots {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitRoots {
            task_id,
            project,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn git_ignored_files(
        &self,
        task_id: Option<String>,
        project: Option<String>,
    ) -> wire::GitIgnoredFiles {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitIgnored {
            task_id,
            project,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn git_add(&self, task_id: &str, paths: Vec<String>) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitAdd {
            task_id: task_id.to_string(),
            paths,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the add request".into()))
    }

    pub async fn git_ignore_paths(&self, task_id: &str, paths: Vec<String>) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitIgnorePaths {
            task_id: task_id.to_string(),
            paths,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the ignore request".into()))
    }

    pub async fn shelf_list(&self, task_id: &str) -> wire::ShelfList {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ShelfList {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn shelf_create(
        &self,
        task_id: &str,
        name: String,
        paths: Option<Vec<String>>,
    ) -> Result<wire::ShelfEntry, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ShelfCreate {
            task_id: task_id.to_string(),
            name,
            paths,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the shelve request".into()))
    }

    pub async fn shelf_get(&self, task_id: &str, id: &str) -> Result<wire::ShelfDiff, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ShelfGet {
            task_id: task_id.to_string(),
            id: id.to_string(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the shelf read request".into()))
    }

    pub async fn shelf_apply(&self, task_id: &str, id: &str, drop: bool) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ShelfApply {
            task_id: task_id.to_string(),
            id: id.to_string(),
            drop,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the unshelve request".into()))
    }

    pub async fn shelf_drop(&self, task_id: &str, id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ShelfDrop {
            task_id: task_id.to_string(),
            id: id.to_string(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the shelf delete request".into()))
    }

    pub async fn stash_list(&self, task_id: &str) -> wire::StashList {
        let (tx, rx) = oneshot::channel();
        self.send(Command::StashList {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn stash_push(
        &self,
        task_id: &str,
        message: String,
        paths: Option<Vec<String>>,
    ) -> Result<wire::StashEntry, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::StashPush {
            task_id: task_id.to_string(),
            message,
            paths,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the stash request".into()))
    }

    pub async fn stash_get(&self, task_id: &str, id: &str) -> Result<wire::StashDiff, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::StashGet {
            task_id: task_id.to_string(),
            id: id.to_string(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the stash read request".into()))
    }

    pub async fn stash_apply(&self, task_id: &str, id: &str, pop: bool) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::StashApply {
            task_id: task_id.to_string(),
            id: id.to_string(),
            pop,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the stash apply request".into()))
    }

    pub async fn stash_checkout_file(
        &self,
        task_id: &str,
        id: &str,
        paths: Vec<String>,
    ) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::StashFile {
            task_id: task_id.to_string(),
            id: id.to_string(),
            paths,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the stash restore request".into()))
    }

    pub async fn stash_drop(&self, task_id: &str, id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::StashDrop {
            task_id: task_id.to_string(),
            id: id.to_string(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the stash delete request".into()))
    }

    pub async fn git_switch_branch(&self, task_id: &str, branch: &str) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitSwitchBranch {
            task_id: task_id.to_string(),
            branch: branch.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| wire::GitOpResult {
            status: wire::GitOpStatus::Error,
            message: "daemon dropped the switch request".into(),
            conflicts: Vec::new(),
            branch: None,
        })
    }

    pub async fn git_branch_rename(
        &self,
        task_id: &str,
        branch: &str,
        new_name: &str,
    ) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitBranchRename {
            task_id: task_id.to_string(),
            branch: branch.to_string(),
            new_name: new_name.to_string(),
            reply: tx,
        })
        .await;
        op_result_or_dropped(rx.await, "daemon dropped the rename request")
    }

    pub async fn git_branch_delete(
        &self,
        task_id: &str,
        branch: &str,
        force: bool,
    ) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitBranchDelete {
            task_id: task_id.to_string(),
            branch: branch.to_string(),
            force,
            reply: tx,
        })
        .await;
        op_result_or_dropped(rx.await, "daemon dropped the delete request")
    }

    pub async fn git_rebase(&self, task_id: &str, branch: &str, target: &str) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitRebase {
            task_id: task_id.to_string(),
            branch: branch.to_string(),
            target: target.to_string(),
            reply: tx,
        })
        .await;
        op_result_or_dropped(rx.await, "daemon dropped the rebase request")
    }

    pub async fn git_branch_create(
        &self,
        task_id: &str,
        name: &str,
        from: Option<String>,
        checkout: bool,
        overwrite: bool,
    ) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitBranchCreate {
            task_id: task_id.to_string(),
            name: name.to_string(),
            from,
            checkout,
            overwrite,
            reply: tx,
        })
        .await;
        op_result_or_dropped(rx.await, "daemon dropped the create-branch request")
    }

    pub async fn git_merge(&self, task_id: &str, target: &str) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitMerge {
            task_id: task_id.to_string(),
            target: target.to_string(),
            reply: tx,
        })
        .await;
        op_result_or_dropped(rx.await, "daemon dropped the merge request")
    }

    pub async fn git_push_info(&self, task_id: &str) -> Result<wire::GitPushInfo, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitPushInfo {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the push preview request".into()))
    }

    pub async fn git_push(&self, task_id: &str, force: bool) -> wire::GitOpResult {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitPush {
            task_id: task_id.to_string(),
            force,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| wire::GitOpResult {
            status: wire::GitOpStatus::Error,
            message: "daemon dropped the push request".into(),
            conflicts: Vec::new(),
            branch: None,
        })
    }

    pub async fn git_create_pr(
        &self,
        task_id: &str,
        title: String,
        body: String,
        base: Option<String>,
    ) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::GitCreatePr {
            task_id: task_id.to_string(),
            title,
            body,
            base,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the create-PR request".into()))
    }
}
