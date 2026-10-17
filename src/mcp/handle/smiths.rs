//! `start_work` (ADR 0027): the daemon checks every limit; this resolves the
//! board item number and words the result.

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::mcp::daemon_client::DaemonClient;

pub(super) async fn dispatch(
    client: &mut DaemonClient,
    caller: &str,
    project: &str,
    args: &Value,
) -> Result<String> {
    if caller.is_empty() {
        return Err(anyhow!("this session is not bound to a task"));
    }
    let text = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };
    let smith = text("smith").ok_or_else(|| anyhow!("'smith' is required"))?;
    let brief = text("brief").ok_or_else(|| anyhow!("'brief' is required"))?;
    let project = text("project").unwrap_or(project);
    if project.is_empty() {
        return Err(anyhow!(
            "'project' is required: this session is not bound to one"
        ));
    }
    let item = match args.get("item").and_then(Value::as_u64) {
        Some(number) => Some(item_id(client, project, number).await?),
        None => None,
    };
    let started = client
        .request(
            "smiths.startWorkFrom",
            json!({
                "from_task_id": caller,
                "smith": smith,
                "project": project,
                "brief": brief,
                "backlog_item_id": item,
            }),
        )
        .await?;
    Ok(format!(
        "Started a work session as {} ({}) in {project}. It reports back to you when it settles.",
        started["smith"].as_str().unwrap_or(smith),
        started["taskId"].as_str().unwrap_or("?"),
    ))
}

async fn item_id(client: &mut DaemonClient, project: &str, number: u64) -> Result<String> {
    let item = super::backlog::find(client, project, &json!({ "number": number })).await?;
    item["id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("no board item #{number} in {project}"))
}
