//! Chats: tasks with no project that run in their own scratch folder.

use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;
use crate::daemon::task::{Task, TaskStatus};

impl Daemon {
    /// @param task_id the task
    /// @returns whether it is a chat
    pub(crate) fn is_chat(&self, task_id: &str) -> bool {
        self.tasks
            .get(task_id)
            .is_some_and(|task| task.kind == wire::TaskKind::Chat)
    }

    /// Turn a new task into a chat and create its folder. A folder that cannot
    /// be created blocks the chat with the reason instead of running it
    /// anywhere else.
    /// @param task the task being created, not yet on the board
    pub(crate) fn make_chat(task: &mut Task) {
        task.kind = wire::TaskKind::Chat;
        task.project.clear();
        if let Err(reason) = crate::daemon::scratch::create(&task.id) {
            task.blocked_reason = Some(reason);
            task.set_status(TaskStatus::Blocked);
        }
    }

    /// Tell a chat's bridge it is one, so it refuses project tools.
    /// @param task_id the session's task
    /// @param env the agent process's environment changes
    /// @param mcp_servers the bridge entries handed to the agent
    pub(crate) fn chat_bridge(
        &self,
        task_id: &str,
        env: &mut crate::daemon::accounts::AgentEnv,
        mcp_servers: &mut [serde_json::Value],
    ) {
        if !self.is_chat(task_id) {
            return;
        }
        let kind = crate::mcp::chat::CHAT;
        env.set
            .insert(crate::mcp::identity::SESSION_KIND.to_string(), kind.into());
        for server in mcp_servers {
            if let Some(vars) = server["env"].as_array_mut() {
                vars.push(serde_json::json!({ "name": "WF_KIND", "value": kind }));
            }
        }
    }
}
