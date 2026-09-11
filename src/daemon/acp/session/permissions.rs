use std::collections::HashMap;

use serde_json::{json, Value};

use crate::daemon::acp::pretty_mcp_tool_label;

use super::Session;

pub(super) struct PendingPerm {
    /// The agent's original JSON-RPC request id, needed to reply.
    pub(super) agent_id: Value,
    /// Client outcome label ("allow" / "allow_always" / "deny") -> ACP optionId.
    pub(super) options: HashMap<String, String>,
}

pub(super) fn answer(session: &Session, request_id: String, outcome: String) {
    if let Some(p) = session.perms.lock().unwrap().remove(&request_id) {
        let result = match p.options.get(&outcome) {
            Some(opt) => {
                json!({ "outcome": { "outcome": "selected", "optionId": opt } })
            }
            None => json!({ "outcome": { "outcome": "cancelled" } }),
        };
        let _ = session
            .out_tx
            .send(json!({"jsonrpc":"2.0","id":p.agent_id,"result":result}).to_string());
    }
}

/// Turn ACP permission options into the client-facing outcome labels plus a
/// label→optionId map for replying. ACP option `kind`s
/// (allow_once/allow_always/reject_once/reject_always) collapse to our three
/// outcomes.
pub(crate) fn parse_permission(
    params: &Value,
) -> (String, Vec<String>, HashMap<String, String>, Option<String>) {
    let title = params
        .get("toolCall")
        .and_then(|t| t.get("title"))
        .and_then(|t| t.as_str())
        .unwrap_or("Permission request");
    // The tool call being gated. Carrying it through lets the UI put the
    // prompt on that tool's own row rather than in a card beside it — the two
    // are one event, and the titles differ (the prompt shows the tool's title,
    // the row shows the command), so nothing downstream can rejoin them.
    let tool_call_id = params
        .get("toolCall")
        .and_then(|t| t.get("toolCallId"))
        .and_then(|t| t.as_str())
        .map(str::to_string);
    // Prettify an MCP tool title (mcp__server__tool or warpforge_tool) for the
    // permission line too; pretty_mcp_tool_label leaves non-MCP titles as-is.
    let title = pretty_mcp_tool_label(title);

    let mut map: HashMap<String, String> = HashMap::new();
    if let Some(opts) = params.get("options").and_then(|o| o.as_array()) {
        for opt in opts {
            let option_id = opt.get("optionId").and_then(|v| v.as_str()).unwrap_or("");
            let kind = opt.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let label = match kind {
                "allow_once" => "allow",
                "allow_always" => "allow_always",
                "reject_once" | "reject_always" => "deny",
                _ => continue,
            };
            map.entry(label.to_string())
                .or_insert_with(|| option_id.to_string());
        }
    }

    // Present in a stable, sensible order.
    let mut options = Vec::new();
    for label in ["allow", "allow_always", "deny"] {
        if map.contains_key(label) {
            options.push(label.to_string());
        }
    }
    (title, options, map, tool_call_id)
}
