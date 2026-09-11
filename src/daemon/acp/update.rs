use serde_json::Value;
use warpforge_protocol as wire;

use super::edits::edit_info;
use super::model::parse_config_options;
use super::tool::{content_text, tool_details, tool_title};
use super::AcpUpdate;

pub(super) fn parse_update(params: &Value) -> Option<AcpUpdate> {
    let update = params.get("update")?;
    let kind = update.get("sessionUpdate")?.as_str()?;
    match kind {
        "agent_message_chunk" => Some(AcpUpdate::AgentText(content_text(update.get("content")?)?)),
        "agent_thought_chunk" => Some(AcpUpdate::AgentThought(content_text(
            update.get("content")?,
        )?)),
        "tool_call" | "tool_call_update" => {
            let id = update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let status = update
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("in_progress")
                .to_string();
            let kind = update
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("other")
                .to_string();
            // A file edit still emits a dedicated FileEdit for the diff badge…
            if kind == "edit" {
                if let Some(edit) = edit_info(update) {
                    return Some(AcpUpdate::FileEdit {
                        path: edit.path,
                        tool_call_id: id,
                        additions: edit.additions,
                        deletions: edit.deletions,
                        hunks: edit.hunks,
                    });
                }
            }
            let title = tool_title(update, &id, &kind);
            Some(AcpUpdate::ToolCall {
                id,
                title,
                status,
                kind,
                content: tool_details(update),
            })
        }
        "plan" => {
            let entries = update
                .get("entries")?
                .as_array()?
                .iter()
                .map(|e| wire::PlanEntry {
                    content: e
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    status: e
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("pending")
                        .to_string(),
                    priority: e.get("priority").and_then(|v| v.as_str()).map(String::from),
                })
                .collect();
            Some(AcpUpdate::Plan { entries })
        }
        "available_commands_update" => {
            let commands = update
                .get("availableCommands")?
                .as_array()?
                .iter()
                .map(|c| wire::CommandInfo {
                    name: c
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    description: c
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect();
            Some(AcpUpdate::AvailableCommands { commands })
        }
        "config_option_update" => Some(AcpUpdate::ConfigOptions {
            options: parse_config_options(update.get("configOptions")),
        }),
        "usage_update" => {
            let used = update.get("used")?.as_u64()?;
            let size = update.get("size")?.as_u64()?;
            let cost = update.get("cost").and_then(|value| {
                Some(wire::SessionUsageCost {
                    amount: value.get("amount")?.as_f64()?,
                    currency: value.get("currency")?.as_str()?.to_string(),
                })
            });
            Some(AcpUpdate::Usage { used, size, cost })
        }
        _ => None, // user_message_chunk (our own echo), current_mode_update, etc.
    }
}
