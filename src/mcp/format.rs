use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use super::agents::truncate_chars;

/// Keep MCP calls within the project that owns the orchestrator session. The
/// optional argument is useful for tests and for older daemons that do not set
/// WF_ORCH_PROJECT, but cannot be used to escape a non-empty environment scope.
pub(crate) fn scoped_project(args: &Value, orchestrator_project: &str) -> Result<Option<String>> {
    let requested = match args.get("project") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) if !value.trim().is_empty() => Some(value.clone()),
        Some(Value::String(_)) => None,
        Some(_) => return Err(anyhow!("'project' must be a string")),
    };

    if !orchestrator_project.is_empty() {
        if let Some(requested) = requested.as_deref() {
            if requested != orchestrator_project {
                return Err(anyhow!(
                    "project '{requested}' is outside the orchestrator project '{orchestrator_project}'"
                ));
            }
        }
        return Ok(Some(orchestrator_project.to_string()));
    }

    // No bound project scope: a requested project would let a session reach a
    // project it does not own. Refuse rather than fall back to the caller's arg.
    match requested {
        None => Ok(None),
        Some(_) => Err(anyhow!(
            "this session is not bound to a project; cannot target another project"
        )),
    }
}

/// Parse a tool's optional `limit`, clamped to the daemon's u32 window size,
/// defaulting to 100 lines so an omitted limit cannot dump the whole buffer.
pub(crate) fn tool_limit(args: &Value) -> u32 {
    args.get("limit")
        .and_then(Value::as_u64)
        .map(|v| v.min(u32::MAX as u64) as u32)
        .unwrap_or(100)
}

/// Pipeline progress: stage, review round, and — crucially — when the pipeline
/// is waiting on the caller (a question to answer via `answer_workflow`, or a
/// round limit to decide on via `decide_workflow`).
pub(crate) fn render_workflow_run(wf: &Value) -> String {
    let stage = wf.get("stage").and_then(Value::as_str).unwrap_or("?");
    let mut out = format!(" | wf stage={stage}");
    if let (Some(round), Some(max)) = (
        wf.get("round").and_then(Value::as_u64),
        wf.get("maxRounds").and_then(Value::as_u64),
    ) {
        out.push_str(&format!(" round={round}/{max}"));
    }
    if let Some(waiting) = wf.get("waiting").filter(|v| !v.is_null()) {
        let kind = waiting.get("kind").and_then(Value::as_str).unwrap_or("?");
        out.push_str(&format!(" waiting={kind}"));
        if let Some(q) = waiting
            .get("question")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            out.push_str(&format!(": {}", truncate_chars(q, 120)));
        }
    }
    out
}

/// Compact `plan:complete implement:running review:pending` style summary of an
/// orchestration graph. Returns None when the graph carries no nodes — a full
/// node dump would be far too large to be worth keeping.
pub(crate) fn graph_node_summary(graph: &Value) -> Option<String> {
    let nodes = graph.get("nodes").and_then(Value::as_array)?;
    if nodes.is_empty() {
        return None;
    }
    let summary = nodes
        .iter()
        .map(|n| {
            let kind = n.get("kind").and_then(Value::as_str).unwrap_or("?");
            let status = n.get("status").and_then(Value::as_str).unwrap_or("?");
            format!("{kind}:{status}")
        })
        .collect::<Vec<_>>()
        .join(" ");
    Some(truncate_chars(&summary, 160))
}

pub(crate) fn json_text(value: &Value) -> Result<String> {
    serde_json::to_string_pretty(value).context("encoding MCP JSON result")
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
