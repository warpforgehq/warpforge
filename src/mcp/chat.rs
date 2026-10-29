//! What a chat's bridge refuses or narrows: a chat has no project, so nothing
//! it calls may reach a project's board, runtime or memory.

use anyhow::{bail, Result};
use serde_json::{json, Value};

/// The `WARPFORGE_SESSION_KIND` / `WF_KIND` value that marks a chat.
pub(crate) const CHAT: &str = "chat";

const PROJECT_TOOLS: &[&str] = &[
    "create_backlog_task",
    "create_task",
    "list_backlog_tasks",
    "get_backlog_task",
    "update_backlog_task",
    "close_backlog_task",
    "runner_enqueue",
    "runner_status",
    "automation_create",
    "automation_list",
    "automation_get",
    "automation_update",
    "automation_delete",
    "automation_run_now",
    "automation_runs",
    "list_runtime",
    "read_service_logs",
    "read_portforward_logs",
    "service_start",
    "service_stop",
    "service_restart",
    "portforward_start",
    "portforward_stop",
];

/// @param name the tool called
/// @param params the `tools/call` params
/// @returns params narrowed to global memory, `None` to use them as they are,
///   or an error for a tool that needs a project
pub(crate) fn confine(name: &str, params: Option<&Value>) -> Result<Option<Value>> {
    if PROJECT_TOOLS.contains(&name) {
        bail!("'{name}' needs a project, and this chat has none");
    }
    let args = params.and_then(|p| p.get("arguments"));
    let scope = args.and_then(|a| a.get("scope")).and_then(Value::as_str);
    match name {
        "memory_store" => {
            let project_id = args
                .and_then(|a| a.get("project_id"))
                .and_then(Value::as_str);
            if project_id.is_some_and(|p| !p.trim().is_empty()) || scope == Some("project") {
                bail!("a chat stores memory in the global scope only");
            }
            Ok(None)
        }
        "memory_search" | "memory_list" if scope != Some("journal") => {
            let mut narrowed = params.cloned().unwrap_or_else(|| json!({}));
            narrowed["arguments"]["scope"] = json!("global");
            Ok(Some(narrowed))
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, arguments: Value) -> Value {
        json!({ "name": name, "arguments": arguments })
    }

    #[test]
    fn board_and_runtime_tools_are_refused() {
        for name in [
            "create_backlog_task",
            "list_backlog_tasks",
            "service_restart",
        ] {
            let error = confine(name, Some(&call(name, json!({})))).unwrap_err();
            assert!(error.to_string().contains("needs a project"), "{error}");
        }
    }

    #[test]
    fn memory_is_kept_global() {
        let store = call(
            "memory_store",
            json!({ "content": "x", "project_id": "demo" }),
        );
        assert!(confine("memory_store", Some(&store)).is_err());
        let store = call("memory_store", json!({ "content": "x" }));
        assert!(confine("memory_store", Some(&store)).unwrap().is_none());

        let search = call("memory_search", json!({ "query": "x", "scope": "project" }));
        let narrowed = confine("memory_search", Some(&search)).unwrap().unwrap();
        assert_eq!(narrowed["arguments"]["scope"], "global");
        assert_eq!(narrowed["arguments"]["query"], "x");
    }
}
