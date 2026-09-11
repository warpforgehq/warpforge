use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::mcp::daemon_client::DaemonClient;
use crate::mcp::format::json_text;

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    args: &Value,
    project: &str,
) -> Result<String> {
    match name {
        "memory_store" => {
            let content = args
                .get("content")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'content' is required"))?;
            // Lenient project scoping: an explicit project_id wins, else the
            // bridge's bound project, else none (global). Deliberately not the
            // erroring `scoped_project` helper — global-scoped stores must work
            // even when the session is not bound to a project.
            let project_id = args
                .get("project_id")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
                .or_else(|| {
                    let p = project.trim();
                    if p.is_empty() {
                        None
                    } else {
                        Some(p.to_string())
                    }
                });
            let scope = args
                .get("scope")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string);
            let kind = args
                .get("kind")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string);
            let tags = args
                .get("tags")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .filter(|t| !t.is_empty());
            let mut params = json!({ "content": content });
            if let Some(v) = scope {
                params["scope"] = json!(v);
            }
            if let Some(v) = kind {
                params["kind"] = json!(v);
            }
            if let Some(v) = tags {
                params["tags"] = json!(v);
            }
            if let Some(v) = project_id {
                params["project_id"] = json!(v);
            }
            let result = client.request("memory.store", params).await?;
            json_text(&result)
        }
        "memory_search" => {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'query' is required"))?;
            let mut params = json!({ "query": query });
            if let Some(v) = args
                .get("scope")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                params["scope"] = json!(v);
            }
            if let Some(v) = args.get("limit").and_then(Value::as_u64) {
                params["limit"] = json!(v.min(u32::MAX as u64));
            }
            if let Some(v) = args
                .get("mode")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                params["mode"] = json!(v);
            }
            let result = client.request("memory.search", params).await?;
            json_text(&result)
        }
        "memory_list" => {
            let mut params = json!({});
            if let Some(v) = args
                .get("scope")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                params["scope"] = json!(v);
            }
            if let Some(v) = args
                .get("kind")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                params["kind"] = json!(v);
            }
            if let Some(v) = args.get("limit").and_then(Value::as_u64) {
                params["limit"] = json!(v.min(u32::MAX as u64));
            }
            if let Some(v) = args.get("offset").and_then(Value::as_u64) {
                params["offset"] = json!(v.min(u32::MAX as u64));
            }
            let result = client.request("memory.list", params).await?;
            json_text(&result)
        }
        "memory_update" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'id' is required"))?;
            let content = args
                .get("content")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'content' is required"))?;
            let result = client
                .request("memory.update", json!({ "id": id, "content": content }))
                .await?;
            json_text(&result)
        }
        "memory_delete" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'id' is required"))?;
            let result = client.request("memory.delete", json!({ "id": id })).await?;
            json_text(&result)
        }
        "memory_stats" => {
            let result = client.request("memory.stats", json!({})).await?;
            json_text(&result)
        }
        "memory_dream" => {
            let dry_run = args
                .get("dry_run")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let result = client
                .request("memory.dream", json!({"dry_run": dry_run}))
                .await?;
            json_text(&result)
        }
        "memory_resolve_compaction" => {
            let id = args
                .get("id")
                .and_then(Value::as_u64)
                .ok_or_else(|| anyhow!("'id' is required"))? as i64;
            let approve = args.get("approve").and_then(Value::as_bool).unwrap_or(true);
            let result = client
                .request(
                    "memory.resolveCompaction",
                    json!({"id": id, "approve": approve}),
                )
                .await?;
            json_text(&result)
        }
        "memory_list_compaction" => {
            let result = client.request("memory.listCompaction", json!({})).await?;
            json_text(&result)
        }
        "memory_addEdge" => {
            let src_id = args
                .get("src_id")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'src_id' is required"))?;
            let dst_id = args
                .get("dst_id")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'dst_id' is required"))?;
            let relation = args
                .get("relation")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'relation' is required"))?;
            let result = client
                .request(
                    "memory.addEdge",
                    json!({ "src_id": src_id, "dst_id": dst_id, "relation": relation }),
                )
                .await?;
            json_text(&result)
        }
        "memory_edges" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'id' is required"))?;
            let result = client.request("memory.edges", json!({ "id": id })).await?;
            json_text(&result)
        }
        other => Err(anyhow!("unknown tool: {other}")),
    }
}
