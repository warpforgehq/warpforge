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

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

mod agents;
mod automations;
mod daemon_client;
mod format;
mod handle;
mod logs;
#[cfg(test)]
mod tests;
mod tools;

pub(crate) use daemon_client::DaemonClient;
pub(crate) use tools::tool_defs;

/// MCP protocol version we implement.
const MCP_VERSION: &str = "2024-11-05";

/// Entry point for the hidden `wf __mcp-orchestrator` subcommand.
pub async fn run() -> Result<()> {
    let is_orchestrator =
        std::env::var("WF_MODE").as_deref() == Ok("orchestrator") || parent_task_env_is_orch();
    let parent_task = std::env::var("WF_TASK")
        .or_else(|_| std::env::var("WF_ORCH_TASK"))
        .ok();
    if is_orchestrator && parent_task.is_none() {
        return Err(anyhow!(
            "WF_TASK not set — an orchestrator bridge is spawned by the daemon"
        ));
    }
    let parent_task = parent_task.unwrap_or_default();
    let project = std::env::var("WF_PROJECT")
        .or_else(|_| std::env::var("WF_ORCH_PROJECT"))
        .ok()
        .filter(|p| !p.trim().is_empty())
        .or_else(project_from_cwd)
        .unwrap_or_default();

    log(&format!(
        "starting: parent_task={parent_task} project={project} mode={}",
        if is_orchestrator {
            "orchestrator"
        } else {
            "single"
        }
    ));
    // Serve MCP immediately and connect to the daemon lazily on the first tool
    // call. If we connected up-front and the daemon were briefly unreachable,
    // the whole server would die before advertising any tools — leaving the
    // orchestrator with no spawn_agent/read_inbox at all.
    let client = DaemonClient {
        ws: None,
        next_id: 1,
    };
    serve_stdio(client, parent_task, project, is_orchestrator).await
}

/// A legacy daemon sets `WF_ORCH_TASK` but not `WF_MODE`; treat that as an
/// orchestrator session so the old env still yields the orchestrator tools.
fn parent_task_env_is_orch() -> bool {
    std::env::var("WF_MODE").is_err() && std::env::var("WF_ORCH_TASK").is_ok()
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
/// under `<project>/.worktrees/<task>` resolves to its project.
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
    eprintln!("[wf-mcp] {msg}");
}

/// The MCP stdio loop: newline-delimited JSON-RPC 2.0 with the agent.
async fn serve_stdio(
    mut client: DaemonClient,
    parent_task: String,
    project: String,
    is_orchestrator: bool,
) -> Result<()> {
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();

    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(req) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(Value::as_str).unwrap_or("");

        // Notifications (no id) get no response.
        let result: Option<Value> = match method {
            "initialize" => Some(json!({
                "protocolVersion": MCP_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "warpforge",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            })),
            "tools/list" => Some(json!({ "tools": tool_defs(is_orchestrator) })),
            "tools/call" => Some(
                match handle::handle_tool_call(
                    &mut client,
                    &parent_task,
                    &project,
                    is_orchestrator,
                    req.get("params"),
                )
                .await
                {
                    Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                    Err(e) => json!({
                        "content": [{ "type": "text", "text": format!("Error: {e}") }],
                        "isError": true,
                    }),
                },
            ),
            "ping" => Some(json!({})),
            _ => None,
        };

        if let (Some(id), Some(result)) = (id, result) {
            let frame = json!({ "jsonrpc": "2.0", "id": id, "result": result });
            stdout.write_all(frame.to_string().as_bytes()).await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }
    }
    Ok(())
}
