use serde_json::Value;

/// Produce a useful title even when an agent omits ACP's optional `title`.
/// Codex and Claude adapters commonly leave the command/path in `rawInput`
/// while OpenCode already sends a display-ready title.
pub(super) fn tool_title(update: &Value, id: &str, kind: &str) -> String {
    if let Some(title) = update
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty() && *title != id)
    {
        // MCP tools arrive titled `mcp__<server>__<tool>`. Render a human label
        // (and surface the spawned agent for spawn_agent) so the UI, toasts and
        // permission prompts don't show the raw underscore name.
        if let Some(pretty) = pretty_mcp_tool_title(title, update) {
            return pretty;
        }
        return title.to_string();
    }

    let raw_input = update.get("rawInput");
    if kind == "execute" {
        if let Some(command) = raw_input.and_then(|input| input_value(input, &["command", "cmd"])) {
            return command;
        }
    }

    let path = first_location_path(update).or_else(|| {
        raw_input.and_then(|input| input_value(input, &["path", "filePath", "filepath"]))
    });
    if let Some(path) = path {
        let action = match kind {
            "read" => "Read",
            "edit" => "Edit",
            "delete" => "Delete",
            "move" => "Move",
            _ => "Open",
        };
        return format!("{action} {path}");
    }

    if let Some(query) = raw_input.and_then(|input| input_value(input, &["query", "pattern"])) {
        return format!("Search for {query}");
    }
    if let Some(url) = raw_input.and_then(|input| input_value(input, &["url"])) {
        return format!("Fetch {url}");
    }

    match kind {
        "execute" => "Run command",
        "read" => "Read file",
        "edit" => "Edit file",
        "delete" => "Delete file",
        "move" => "Move file",
        "search" => "Search workspace",
        "fetch" => "Fetch resource",
        "think" => "Think",
        _ => "Use tool",
    }
    .to_string()
}

/// Turn an MCP tool title into a human label; for `spawn_agent` also surface
/// which agent + task is being dispatched so the orchestrator's spawn is visible
/// without expanding the tool. Handles both naming conventions agents emit:
/// opencode's `warpforge_list_runtime` and Claude's `mcp__warpforge__list_runtime`.
/// Returns `None` when the title is not an MCP-shaped tool name.
fn pretty_mcp_tool_title(title: &str, update: &Value) -> Option<String> {
    // opencode convention: `<server>_<tool>`, e.g. `warpforge_list_runtime`.
    if let Some((server, tool)) = title.split_once('_') {
        if server == "warpforge" {
            return Some(render_mcp_tool(server, tool, update));
        }
    }
    // Claude convention: `mcp__<server>__<tool>`.
    let mut parts = title.splitn(3, "__");
    if parts.next()? != "mcp" {
        return None;
    }
    let server = parts.next()?;
    let tool = parts.next()?;
    Some(render_mcp_tool(server, tool, update))
}

fn render_mcp_tool(server: &str, tool: &str, update: &Value) -> String {
    if tool == "spawn_agent" {
        let raw = update.get("rawInput");
        let agent = raw.and_then(|i| input_value(i, &["agent", "name"]));
        let task = raw.and_then(|i| input_value(i, &["task", "description"]));
        return match (agent, task) {
            (Some(a), Some(t)) => format!("Spawn agent {a}: {t}"),
            (Some(a), None) => format!("Spawn agent {a}"),
            (None, Some(t)) => format!("Spawn agent: {t}"),
            (None, None) => "Spawn agent".to_string(),
        };
    }
    if server.is_empty() || tool.is_empty() {
        return format!("{server} {tool}").trim().to_string();
    }
    // Just the tool, in normal words — no underscores, no server namespace.
    title_case(&snake_to_words(tool))
}

/// Render an MCP tool label from a bare title string (no rawInput). Handles
/// `mcp__<server>__<tool>` and `<server>_<tool>`. Falls back to the original.
pub fn pretty_mcp_tool_label(title: &str) -> String {
    let tool = if let Some(rest) = title.strip_prefix("mcp__") {
        let mut parts = rest.splitn(2, "__");
        let Some(t) = parts.nth(1) else {
            return title.to_string();
        };
        t
    } else if let Some((s, t)) = title.split_once('_') {
        if s != "warpforge" {
            return title.to_string();
        }
        t
    } else {
        return title.to_string();
    };
    if tool.is_empty() {
        return title.to_string();
    }
    title_case(&snake_to_words(tool))
}

fn snake_to_words(s: &str) -> String {
    s.split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_case(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn input_value(input: &Value, keys: &[&str]) -> Option<String> {
    let value = keys.iter().find_map(|key| input.get(*key))?;
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    let parts = value
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join(" "))
}

fn first_location_path(update: &Value) -> Option<String> {
    update
        .get("locations")
        .and_then(Value::as_array)
        .and_then(|locations| locations.first())
        .and_then(|location| location.get("path"))
        .and_then(Value::as_str)
        .map(String::from)
}

/// Prefer rendered ACP content, then fall back to raw output/input so tool
/// cards remain expandable across agents with different payload fidelity.
pub(super) fn tool_details(update: &Value) -> Option<String> {
    let mut out = String::new();
    let arr = update.get("content").and_then(Value::as_array);
    for item in arr.into_iter().flatten() {
        if let Some(block) = item.get("content") {
            if let Some(t) = content_text(block) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(&t);
            }
        }
    }
    if !out.is_empty() {
        return Some(out);
    }

    update
        .get("rawOutput")
        .and_then(display_json_value)
        .or_else(|| update.get("rawInput").and_then(display_json_value))
}

fn display_json_value(value: &Value) -> Option<String> {
    if value.is_null() {
        return None;
    }
    if let Some(text) = value.as_str() {
        return (!text.trim().is_empty()).then(|| text.to_string());
    }
    serde_json::to_string_pretty(value).ok()
}

/// Extract display text from an ACP content value, tolerating the shapes real
/// agents use: a `{ text }` block, a bare string, or an array of blocks.
pub(super) fn content_text(content: &Value) -> Option<String> {
    if let Some(t) = content.get("text").and_then(|v| v.as_str()) {
        return Some(t.to_string());
    }
    if let Some(t) = content.as_str() {
        return Some(t.to_string());
    }
    if let Some(arr) = content.as_array() {
        let joined: String = arr
            .iter()
            .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
            .collect();
        if !joined.is_empty() {
            return Some(joined);
        }
    }
    None
}
