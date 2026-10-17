//! MCP (Model Context Protocol) stdio server exposing orchestration tools to an
//! orchestrator agent.
//!
//! The orchestrator agent spawns this binary as an MCP server subprocess (wired
//! via the ACP `mcpServers` config). It speaks MCP JSON-RPC 2.0 over stdio to
//! the agent and connects *back* to the running warpforge daemon over the
//! daemon's WebSocket API (endpoint + token from `~/.warpforge/daemon.json`),
//! translating tool calls into daemon commands.
//!
//! Tools:
//! - `spawn_agent(agent, task)` — dispatch a sub-agent asynchronously; returns
//!   immediately. The result lands in the orchestrator's inbox on completion.
//! - `read_inbox()` — drain finished sub-agent results.
//! - `message_agent(task_id, message)` — send a follow-up message to a running
//!   or idle sub-agent, continuing the same session.
//! - `list_agents(project?)` — list this orchestrator's child sessions.
//! - `stop_agent(task_id)` — hard-stop one owned child session while retaining
//!   history. Also stops an owned workflow pipeline.
//! - `cleanup_agents(max_age_seconds?, dry_run?, include_active?)` — permanently
//!   remove selected child sessions and their task history.
//! - `spawn_workflow(workflow_id, goal, agent)` — dispatch a deterministic
//!   multi-stage pipeline (plan/implement/review/fix) as a child of this
//!   orchestrator, same lifecycle as `spawn_agent`.
//! - `pause_workflow(task_id)` / `resume_workflow(task_id, note?)` — soft-pause
//!   an owned pipeline at its next stage boundary, or resume it.
//! - `answer_workflow(task_id, message)` — answer a pipeline stage's pending
//!   question (`need_user_input`).
//! - `decide_workflow(task_id, decision, rounds?, note?)` — decide what an
//!   owned pipeline does once it has exhausted its review rounds.
//!
//! Environment (set by the daemon when it starts the session; legacy daemons
//! set the `WF_ORCH_*` spellings instead):
//! - `WF_TASK`    — the session's task id (the inbox owner / parent).
//! - `WF_PROJECT` — the project this session is scoped to. Unset falls back to
//!   the registered project containing the working directory, so the bridge can
//!   also be configured once globally and run outside the daemon.
//! - `WF_MODE`    — `orchestrator` to expose the spawn/inbox/workflow tools on
//!   top of the runtime ones. Anything else (or unset) means a single session.
//! - `WARPFORGE_SESSION_TASK` / `_PROJECT` / `_MODE` — the same three, set on the
//!   agent process rather than the server entry; they take precedence
//!   (`identity.rs`).

use anyhow::Result;
use std::io::Write;
use std::path::{Path, PathBuf};
use tokio::io::BufReader;

mod agents;
mod automations;
mod daemon_client;
mod format;
mod handle;
pub(crate) mod identity;
mod logs;
mod serve;
#[cfg(test)]
mod tests;
mod tools;
pub(crate) mod untrusted;

pub(crate) use daemon_client::DaemonClient;
pub(crate) use tools::{
    advisor_tool_defs, browser_tool_defs, tool_defs, READ_ONLY_TOOLS, THREAD_TOOLS,
};

/// MCP protocol version we implement.
const MCP_VERSION: &str = "2024-11-05";

/// Entry point for the hidden `wf __mcp-orchestrator` subcommand.
pub async fn run() -> Result<()> {
    let identity = identity::resolve(|name| std::env::var(name).ok())?;
    let project = identity
        .project
        .or_else(project_from_cwd)
        .unwrap_or_default();
    log(&format!(
        "starting: parent_task={} project={project} mode={} from={}",
        identity.parent_task,
        if identity.is_orchestrator {
            "orchestrator"
        } else {
            "single"
        },
        if identity.from_session {
            "session"
        } else {
            "entry"
        }
    ));
    // Serve MCP immediately and connect to the daemon lazily on the first tool
    // call. If we connected up-front and the daemon were briefly unreachable,
    // the whole server would die before advertising any tools — leaving the
    // orchestrator with no spawn_agent/read_inbox at all.
    let mut client = DaemonClient::new(Box::new(daemon_client::PublishedDaemon));
    let session = serve::Session {
        parent_task: identity.parent_task,
        project,
        is_orchestrator: identity.is_orchestrator,
        mode: identity.mode,
    };
    let stdin = BufReader::new(tokio::io::stdin());
    serve::serve(stdin, tokio::io::stdout(), &mut client, &session).await
}

/// Fall back to the registered project whose path contains the working
/// directory. This is what lets the bridge be configured once, globally
/// (`claude mcp add --scope user`, no env), instead of per project: an agent
/// started inside a project's checkout scopes itself to that project. The
/// deepest matching path wins, so a project nested inside another resolves to
/// the inner one.
fn project_from_cwd() -> Option<String> {
    let cwd = std::env::current_dir().ok()?.canonicalize().ok()?;
    let roots: Vec<(String, PathBuf)> = crate::registry::list_projects()
        .ok()?
        .into_iter()
        .filter_map(|p| {
            Path::new(&p.path)
                .canonicalize()
                .ok()
                .map(|root| (p.name, root))
        })
        .collect();
    pick_project(&roots, &cwd)
}

/// The deepest registered root containing `cwd`. Deepest rather than first so a
/// project nested inside another resolves to the inner one; a task worktree
/// under `<project>/.warpforge/worktrees/<task>` (or legacy `.worktrees/`)
/// resolves to its project.
fn pick_project(roots: &[(String, PathBuf)], cwd: &Path) -> Option<String> {
    roots
        .iter()
        .filter(|(_, root)| cwd.starts_with(root))
        .max_by_key(|(_, root)| root.components().count())
        .map(|(name, _)| name.clone())
}

/// Diagnostics to stderr (the ACP agent may forward this to the daemon's
/// `[acp <id> stderr]`). Set WF_MCP_DEBUG=1 for verbose lines.
fn log(msg: &str) {
    // `eprintln!` panics when the write fails, e.g. once the agent closed the pipe.
    let _ = writeln!(std::io::stderr(), "[wf-mcp] {msg}");
}
