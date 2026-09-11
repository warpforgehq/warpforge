//! ACP (Agent Client Protocol) client: the daemon speaks ACP *as a client* to
//! an agent process (Claude Code, Codex, any conforming agent) over its stdio,
//! newline-delimited JSON-RPC 2.0.
//!
//! One agent binary is the abstraction — there is no per-agent code. A task's
//! `agent` resolves to a command; we spawn it, `initialize`, `session/new`,
//! then `session/prompt`, and stream the agent's `session/update`
//! notifications back as [`AcpUpdate`]s. The agent's own requests
//! (`session/request_permission`, `fs/read_text_file`, `fs/write_text_file`)
//! are handled here: file ops directly, permission by surfacing it to the UI
//! and replying once the human answers.

use std::collections::HashMap;

use tokio::sync::{mpsc, oneshot};
use warpforge_protocol as wire;

use crate::daemon::prompt::{PreparedPrompt, PromptContent};
use crate::policies::{PolicyContext, PolicyResult};

mod edits;
mod handle;
mod model;
mod process;
mod prompt;
mod rpc;
mod session;
mod tool;
mod update;

#[cfg(test)]
mod tests;

pub use handle::AcpHandle;
pub use model::parse_config_options;
pub use process::STOP_GRACE;
pub use session::spawn_acp_session;
pub use tool::pretty_mcp_tool_label;

pub(crate) use model::is_model_selector;

/// A request from the ACP reader to evaluate a policy before executing an op.
pub struct PolicyCheck {
    pub ctx: PolicyContext,
    pub reply: oneshot::Sender<PolicyResult>,
}

/// An update from an agent session, forwarded to the daemon actor as
/// `(task_id, AcpUpdate)`.
#[derive(Debug, Clone)]
pub enum AcpUpdate {
    SessionStarted {
        session_id: String,
    },
    AgentText(String),
    AgentThought(String),
    ToolCall {
        id: String,
        title: String,
        status: String,
        kind: String,
        content: Option<String>,
    },
    FileEdit {
        path: String,
        tool_call_id: String,
        additions: Option<u32>,
        deletions: Option<u32>,
        hunks: Vec<wire::EditHunk>,
    },
    PermissionRequest {
        request_id: String,
        title: String,
        options: Vec<String>,
        tool_call_id: Option<String>,
    },
    Plan {
        entries: Vec<wire::PlanEntry>,
    },
    AvailableCommands {
        commands: Vec<wire::CommandInfo>,
    },
    ConfigOptions {
        options: Vec<wire::ConfigOption>,
    },
    Usage {
        used: u64,
        size: u64,
        cost: Option<wire::SessionUsageCost>,
    },
    PromptCapabilities {
        image: bool,
        embedded_context: bool,
    },
    TurnEnded {
        stop_reason: String,
    },
    /// A model the user (or task creation) asked for could not be applied to
    /// the session — rejected, transport gone, or timed out. Non-fatal: the
    /// session keeps running on the agent's current model, and the actor
    /// records the mismatch as durable task state so the user still sees it.
    ModelMismatch {
        message: String,
    },
    Error {
        run_id: u64,
        message: String,
        /// Set when the daemon recognised the failure well enough for a client
        /// to offer a way out of it.
        kind: Option<wire::TaskBlockedKind>,
    },
}

pub enum AcpCommand {
    Prompt(PreparedPrompt),
    AnswerPermission {
        request_id: String,
        outcome: String,
    },
    SetConfigOption {
        config_id: String,
        value: String,
        /// Carries the agent's verdict back to the caller so a rejected or
        /// timed-out selector change surfaces instead of vanishing.
        reply: oneshot::Sender<Result<(), String>>,
    },
    Cancel,
}

/// Run an agent one-shot over a self-contained prompt and return its text.
///
/// Unlike a task session this owns an ephemeral, throwaway ACP session: it
/// spawns the agent, sends a single prompt, collects the agent's text until the
/// turn ends, then kills the process. The prompt must carry all context (the
/// diff) inline — permission requests are auto-denied so the agent cannot stall
/// waiting on a human, and there is no policy gate. Used by `text.generate` to
/// draft commit messages and PR descriptions.
pub async fn generate_text(
    command: String,
    cwd: String,
    prompt: String,
    model: Option<String>,
    env: super::accounts::AgentEnv,
) -> Result<String, String> {
    const OVERALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

    let prepared = PreparedPrompt {
        content: vec![PromptContent::Text(prompt)],
        summaries: Vec::new(),
        has_images: false,
    };
    let (tx, mut rx) = mpsc::unbounded_channel();
    let handle = spawn_acp_session(
        "__textgen__".to_string(),
        command,
        cwd,
        prepared,
        None,
        Vec::new(),
        tx,
        None,
        model,
        HashMap::new(),
        env,
    )
    .map_err(|e| format!("failed to start agent: {e}"))?;

    let collect = async {
        let mut text = String::new();
        while let Some((_, update)) = rx.recv().await {
            match update {
                AcpUpdate::AgentText(chunk) => text.push_str(&chunk),
                AcpUpdate::TurnEnded { .. } => return Ok(text),
                AcpUpdate::Error { message, .. } => return Err(message),
                // No human is watching — refuse tool permissions rather than
                // hang. A well-formed prompt with the diff inline never needs them.
                AcpUpdate::PermissionRequest { request_id, .. } => {
                    handle.answer(request_id, "deny".to_string());
                }
                _ => {}
            }
        }
        // Stream closed without a turn end: return whatever we have, if any.
        if text.is_empty() {
            Err("agent produced no output".to_string())
        } else {
            Ok(text)
        }
    };

    let result = match tokio::time::timeout(OVERALL_TIMEOUT, collect).await {
        Ok(r) => r,
        Err(_) => Err("text generation timed out".to_string()),
    };
    handle.cancel();
    result.map(|t| t.trim().to_string()).and_then(|t| {
        if t.is_empty() {
            Err("agent produced no output".to_string())
        } else {
            Ok(t)
        }
    })
}
