use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::mcp::daemon_client::DaemonClient;
use crate::mcp::format::json_text;

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    project: &str,
    args: &Value,
) -> Result<String> {
    match name {
        "create_backlog_task" | "create_task" => {
            let title = args
                .get("title")
                .or_else(|| args.get("prompt"))
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'title' or 'prompt' is required"))?;
            let proj = args
                .get("project")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    let p = project.trim();
                    if p.is_empty() {
                        None
                    } else {
                        Some(p.to_string())
                    }
                })
                .ok_or_else(|| anyhow!("project is required"))?;
            let result = client
                .request(
                    "backlog.create",
                    json!({
                        "project": proj,
                        "title": title,
                        "body": args.get("body").and_then(Value::as_str).unwrap_or_default(),
                        "priority": args.get("priority").and_then(Value::as_str).unwrap_or_default(),
                        "status": args.get("status").and_then(Value::as_str).unwrap_or_default(),
                        "source": "local"
                    }),
                )
                .await?;
            Ok(format!("Created backlog item\n{}", json_text(&result)?))
        }
        other => Err(anyhow!("unknown tool: {other}")),
    }
}
