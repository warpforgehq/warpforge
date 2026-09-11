use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use super::daemon_client::DaemonClient;
use super::format::{graph_node_summary, render_workflow_run, scoped_project};
use super::logs::fmt_utc;

pub(crate) const DEFAULT_CLEANUP_MAX_AGE_SECONDS: u64 = 0;
pub(crate) const INACTIVE_AGENT_STATUSES: &[&str] = &["waiting", "done", "blocked", "interrupted"];
pub(crate) const ACTIVE_AGENT_STATUSES: &[&str] = &["running", "queued"];

/// Confirm a service is declared for the project before claiming a control
/// dispatch succeeded (start/stop/restart RPCs return null unconditionally).
pub(crate) async fn ensure_service(
    client: &mut DaemonClient,
    project: &str,
    service: &str,
) -> Result<()> {
    let result = client
        .request("runtime.list", json!({ "project": project }))
        .await?;
    let declared = result
        .get("services")
        .and_then(Value::as_array)
        .is_some_and(|svcs| {
            svcs.iter()
                .any(|s| s.get("name").and_then(Value::as_str) == Some(service))
        });
    if declared {
        Ok(())
    } else {
        Err(anyhow!(
            "no service '{service}' is declared for project '{project}' (see list_runtime)"
        ))
    }
}

/// Like [`ensure_service`] but for a port-forward name.
pub(crate) async fn ensure_portforward(
    client: &mut DaemonClient,
    project: &str,
    name: &str,
) -> Result<()> {
    let result = client
        .request("runtime.list", json!({ "project": project }))
        .await?;
    let declared = result
        .get("portforwards")
        .and_then(Value::as_array)
        .is_some_and(|pfs| {
            pfs.iter()
                .any(|pf| pf.get("name").and_then(Value::as_str) == Some(name))
        });
    if declared {
        Ok(())
    } else {
        Err(anyhow!(
            "no port-forward '{name}' is declared for project '{project}' (see list_runtime)"
        ))
    }
}

fn is_model_selector(o: &Value) -> bool {
    let cat = o.get("category").and_then(Value::as_str).unwrap_or("");
    let id = o.get("id").and_then(Value::as_str).unwrap_or("");
    let name = o.get("name").and_then(Value::as_str).unwrap_or("");
    format!("{cat} {id} {name}")
        .to_lowercase()
        .contains("model")
}

pub(crate) fn model_ids(models: &[Value]) -> Vec<String> {
    let Some(first) = models.iter().find(|o| is_model_selector(o)) else {
        return Vec::new();
    };
    first
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|c| c.get("value").and_then(Value::as_str).map(String::from))
        .collect()
}

fn format_valid_list(valid: &[String], agent: &str) -> String {
    const CAP: usize = 30;
    if valid.len() <= CAP {
        return valid.join(", ");
    }
    let head = valid[..CAP].join(", ");
    format!(
        "{head} … and {} more (call list_agent_models with agent=\"{agent}\" for the full list)",
        valid.len() - CAP
    )
}

pub(crate) fn validate_model(models: &[Value], requested: &str, agent: &str) -> Result<()> {
    let valid = model_ids(models);
    if valid.is_empty() {
        return Ok(());
    }
    if valid.contains(&requested.to_string()) {
        Ok(())
    } else {
        Err(anyhow!(
            "model '{}' is not valid for agent '{}'; valid ids: [{}]",
            requested,
            agent,
            format_valid_list(&valid, agent)
        ))
    }
}

pub(crate) async fn list_owned_agents(
    client: &mut DaemonClient,
    parent_task: &str,
    project: Option<&str>,
) -> Result<Value> {
    client
        .request(
            "orchestrator.listAgents",
            json!({
                "parent_task_id": parent_task,
                "project": project,
            }),
        )
        .await
}

pub(crate) fn agent_values(result: &Value) -> Result<Vec<Value>> {
    result
        .get("agents")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| anyhow!("daemon returned an invalid orchestrator.listAgents response"))
}

/// Confirm `task_id` is a child of this orchestrator before letting a
/// workflow-control tool touch it — otherwise one orchestrator session could
/// pause/answer/decide a pipeline it does not own.
///
/// TODO(perf, known debt): this fetches and filters the daemon's *entire*
/// task list (`orchestrator.listAgents` → `Command::Tasks` clones every task
/// in every project) just to check one id's `parent_task_id`, then the
/// caller makes a second round trip for the actual `workflow.*` RPC. Cheap in
/// absolute terms (local WebSocket, in-memory clone) but wasteful, and it
/// scales with total daemon task count, not with this orchestrator's work.
/// Deliberately left as-is rather than fixed under time pressure — real fix
/// is a new, purely additive lookup (e.g. `Command::TaskParent { id, reply }`
/// doing an O(1) `self.tasks.get`), NOT touching `workflow.pause/resume/
/// reply/decide` themselves, since desktop UI already depends on those.
pub(crate) async fn ensure_owned(
    client: &mut DaemonClient,
    parent_task: &str,
    project: &str,
    args: &Value,
    task_id: &str,
) -> Result<()> {
    let scoped = scoped_project(args, project)?;
    let result = list_owned_agents(client, parent_task, scoped.as_deref()).await?;
    let agents = agent_values(&result)?;
    let owned = agents
        .iter()
        .any(|agent| agent.get("id").and_then(Value::as_str) == Some(task_id));
    if owned {
        Ok(())
    } else {
        Err(anyhow!(
            "task {task_id} is not a pipeline owned by this orchestrator"
        ))
    }
}

/// Short identifier for what a task is about: the title when set, else the
/// first line of the prompt. Capped hard — the full prompt is often several
/// kilobytes and the caller only needs to tell children apart.
fn short_label(agent: &Value) -> String {
    let raw = agent
        .get("title")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            agent
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or_default()
        });
    let first_line = raw.lines().next().unwrap_or_default().trim();
    truncate_chars(first_line, 80)
}

pub(crate) fn truncate_chars(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        return s.to_string();
    }
    let cut: String = s.chars().take(cap).collect();
    format!("{cut}…")
}

/// One line per child task, pipe-separated. The daemon's `orchestrator.listAgents`
/// reply carries each task's full `configOptions` model selector (100–400
/// entries) and the entire prompt — dumping it raw blew the tool-result limit
/// with four children. Projection keeps only what the caller needs to decide
/// what to do next: id, agent, status, last activity, a short label, changed
/// file count, blockage, and for pipelines the stage/round/waiting state.
pub(crate) fn render_agents_listing(agents: &[Value]) -> String {
    if agents.is_empty() {
        return "No sub-agent sessions — nothing spawned yet.".into();
    }
    let mut out = String::from("id | agent | status | updated | label [| extras]\n");
    for agent in agents {
        out.push_str(&render_agent_line(agent));
        out.push('\n');
    }
    out
}

fn render_agent_line(agent: &Value) -> String {
    let id = agent.get("id").and_then(Value::as_str).unwrap_or("?");
    let name = agent.get("agent").and_then(Value::as_str).unwrap_or("?");
    let status = agent.get("status").and_then(Value::as_str).unwrap_or("?");
    let updated = agent
        .get("updatedAt")
        .and_then(Value::as_u64)
        // TaskInfo timestamps are Unix seconds; fmt_utc wants millis.
        .map(|secs| fmt_utc(secs.saturating_mul(1000)))
        .unwrap_or_else(|| "?".into());
    let mut line = format!("{id} | {name} | {status} | {updated}");
    let label = short_label(agent);
    if !label.is_empty() {
        line.push_str(&format!(" | {label}"));
    }
    let files = agent.get("filesChanged").and_then(Value::as_u64);
    if let Some(files) = files.filter(|f| *f > 0) {
        line.push_str(&format!(" | files={files}"));
    }
    if let Some(reason) = agent
        .get("blockedReason")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        let kind = agent
            .get("blockedKind")
            .and_then(Value::as_str)
            .unwrap_or("blocked");
        line.push_str(&format!(" | {kind}: {}", truncate_chars(reason, 120)));
    }
    if let Some(wf) = agent.get("workflowRun").filter(|v| !v.is_null()) {
        line.push_str(&render_workflow_run(wf));
    }
    if let Some(graph) = agent.get("orchestrationGraph").filter(|v| !v.is_null()) {
        if let Some(summary) = graph_node_summary(graph) {
            line.push_str(&format!(" | graph: {summary}"));
        }
    }
    line
}
