use anyhow::Result;
use tokio::sync::oneshot;

use warpforge_protocol as wire;

use crate::daemon::actor::{Command, DaemonHandle};

impl DaemonHandle {
    pub async fn session_prompt(
        &self,
        task_id: &str,
        text: &str,
        attachments: Vec<wire::PromptAttachment>,
    ) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SessionPrompt {
            task_id: task_id.into(),
            text: text.into(),
            attachments,
            initiator: crate::daemon::acp::TurnInitiator::User,
            peer_message: None,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the prompt request".into()))
    }

    /// Cut the agent's running turn short and hand it every queued message at
    /// once, as a single turn — the chat's "send all now" action.
    pub async fn session_interrupt(&self, task_id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SessionInterrupt {
            task_id: task_id.into(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the interrupt request".into()))
    }

    /// Drop one message still waiting behind a task's running turn. `Err` when
    /// it was already sent or is no longer waiting.
    pub async fn session_remove_queued(
        &self,
        task_id: &str,
        queued_id: &str,
    ) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SessionRemoveQueued {
            task_id: task_id.into(),
            queued_id: queued_id.into(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the remove request".into()))
    }

    /// Replace the text of one message still waiting behind a task's running
    /// turn. `Err` when it was already sent or is no longer waiting.
    pub async fn session_edit_queued(
        &self,
        task_id: &str,
        queued_id: &str,
        text: &str,
    ) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SessionEditQueued {
            task_id: task_id.into(),
            queued_id: queued_id.into(),
            text: text.into(),
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err("daemon dropped the edit request".into()))
    }

    pub async fn list_sessions(&self, project: &str) -> Vec<wire::ExternalSession> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ListSessions {
            project: project.into(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn resume_task(
        &self,
        project: &str,
        agent: &str,
        session_id: &str,
        title: &str,
    ) -> String {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ResumeTask {
            project: project.into(),
            agent: agent.into(),
            session_id: session_id.into(),
            title: title.into(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn detect_agents(&self) -> Vec<wire::DetectedAgent> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::DetectAgents { reply: tx }).await;
        rx.await.unwrap_or_default()
    }

    pub async fn update_agents(&self, agents: Vec<wire::AgentConfig>) {
        self.send(Command::UpdateAgents { agents }).await;
    }

    /// Feed an install's own verification into the agent's tracked health, so
    /// a Settings row does not keep showing a mark an install/reinstall just
    /// fixed (or introduce one an install's own success/failure did not see).
    /// @param id the agent id
    /// @param result `Ok` when the installed agent started, else why it did not
    pub async fn observe_agent_health(&self, id: &str, result: Result<(), String>) {
        self.send(Command::ObserveAgentHealth {
            id: id.into(),
            result,
        })
        .await;
    }

    pub async fn list_accounts(&self) -> Vec<wire::AccountInfo> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ListAccounts { reply: tx }).await;
        rx.await.unwrap_or_default()
    }

    pub async fn list_agent_limits(&self, refresh: bool) -> Vec<wire::AgentAccountLimits> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ListAgentLimits { reply: tx, refresh })
            .await;
        rx.await.unwrap_or_default()
    }

    /// Why a new run of `agent` must not start right now, if it must.
    ///
    /// @param agent the agent id or display name about to run
    /// @returns the quota refusal reason, or `None` to allow the run
    pub async fn dispatch_refusal(&self, agent: &str) -> Option<String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::DispatchRefusal {
            agent: agent.to_string(),
            reply: tx,
        })
        .await;
        rx.await.ok().flatten()
    }

    pub async fn list_agent_spend(&self) -> Vec<wire::AgentSpend> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ListAgentSpend { reply: tx }).await;
        rx.await.unwrap_or_default()
    }

    pub async fn import_account(
        &self,
        agent_id: String,
        label: String,
    ) -> Result<Vec<wire::AccountInfo>, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ImportAccount {
            agent_id,
            label,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon stopped".into()))
    }

    pub async fn rename_account(
        &self,
        account_id: String,
        label: String,
    ) -> Result<Vec<wire::AccountInfo>, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::RenameAccount {
            account_id,
            label,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon stopped".into()))
    }

    pub async fn remove_account(
        &self,
        account_id: String,
    ) -> Result<Vec<wire::AccountInfo>, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::RemoveAccount {
            account_id,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon stopped".into()))
    }

    pub async fn set_active_account(
        &self,
        agent_id: String,
        account_id: String,
    ) -> Result<Vec<wire::AccountInfo>, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SetActiveAccount {
            agent_id,
            account_id,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon stopped".into()))
    }

    /// Re-read an agent's selectors from the harness. Resolves when the probe
    /// finishes so the caller can report a failure instead of silently keeping
    /// the old list.
    pub async fn probe_agent(&self, id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ProbeAgent {
            id: id.into(),
            reply: Some(tx),
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon stopped".into()))
    }

    /// Resolve what a probe for `id` would spawn — command, cwd and account
    /// env — so an install can verify the agent actually starts.
    pub async fn agent_probe_context(
        &self,
        id: &str,
    ) -> Option<crate::daemon::actor::AgentProbeContext> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::AgentProbeContext {
            id: id.into(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or(None)
    }

    pub async fn session_set_config_option(
        &self,
        task_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SessionSetConfigOption {
            task_id: task_id.into(),
            config_id: config_id.into(),
            value: value.into(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon stopped".into()))
    }

    pub async fn session_permission(
        &self,
        task_id: &str,
        request_id: &str,
        outcome: &str,
    ) -> Result<(), crate::daemon::actor::lifecycle::PermissionAnswerError> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SessionPermission {
            task_id: task_id.into(),
            request_id: request_id.into(),
            outcome: outcome.into(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or(Err(
            crate::daemon::actor::lifecycle::PermissionAnswerError::AlreadyResolved {
                outcome: None,
            },
        ))
    }

    pub async fn spawn_agent(
        &self,
        project: &str,
        command: &str,
        description: &str,
        cols: u16,
        rows: u16,
        task_id: Option<String>,
    ) -> Result<String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SpawnAgent {
            project: project.to_string(),
            command: command.to_string(),
            description: description.to_string(),
            cols,
            rows,
            task_id,
            reply: tx,
        })
        .await;
        rx.await
            .unwrap_or_else(|_| Err(anyhow::anyhow!("daemon closed")))
    }

    pub async fn merge_worktree(
        &self,
        task_id: &str,
        remove_worktree: bool,
    ) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::MergeWorktree {
            task_id: task_id.to_string(),
            remove_worktree,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon closed".into()))
    }

    pub async fn list_worktrees(&self, project: &str) -> Vec<wire::WorktreeInfo> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::ListWorktrees {
            project: project.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_default()
    }

    pub async fn settle_task(&self, task_id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SettleTask {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon closed".into()))
    }

    pub async fn unsettle_task(&self, task_id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::UnsettleTask {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon closed".into()))
    }

    pub async fn snooze_task(&self, task_id: &str, until: u64) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::SnoozeTask {
            task_id: task_id.to_string(),
            until,
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon closed".into()))
    }

    pub async fn unsnooze_task(&self, task_id: &str) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.send(Command::UnsnoozeTask {
            task_id: task_id.to_string(),
            reply: tx,
        })
        .await;
        rx.await.unwrap_or_else(|_| Err("daemon closed".into()))
    }
}
