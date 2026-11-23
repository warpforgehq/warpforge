use std::io::Write;
use std::time::Instant;

use anyhow::Result;
use serde_json::{json, Value};

/// File the bridge appends one JSON line to per browser tool call; unset means no logging.
pub(crate) const ENV: &str = "WARPFORGE_BROWSER_BENCH_LOG";

/// Copy the daemon's bench log path into every bridge entry, because an MCP
/// client may start its servers with only a minimal environment.
/// @param servers the session's `mcpServers` entries
pub(crate) fn forward(servers: &mut [Value]) {
    let Ok(path) = std::env::var(ENV) else {
        return;
    };
    for server in servers {
        if let Some(vars) = server["env"].as_array_mut() {
            vars.push(json!({ "name": ENV, "value": path }));
        }
    }
}

/// Append the call's line to the bench log when one is configured.
/// @param task the session's task
/// @param tool the browser tool name
/// @param args the tool call's arguments
/// @param result what the call returned to the agent
/// @param started when the call began
pub(crate) fn record(
    task: &str,
    tool: &str,
    args: &Value,
    result: &Result<Vec<Value>>,
    started: Instant,
) {
    let Ok(path) = std::env::var(ENV) else {
        return;
    };
    let mut entry = line(task, tool, args, result);
    entry["ts"] = json!(chrono::Utc::now().to_rfc3339());
    entry["ms"] = json!(started.elapsed().as_millis() as u64);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = file.write_all(format!("{entry}\n").as_bytes());
    }
}

fn line(task: &str, tool: &str, args: &Value, result: &Result<Vec<Value>>) -> Value {
    let mut kept = serde_json::Map::new();
    for key in [
        "ref",
        "url",
        "submit",
        "interactive",
        "scope",
        "headings",
        "to",
        "pages",
        "key",
        "gone",
        "ref_gone",
        "timeout_ms",
    ] {
        if let Some(value) = args.get(key) {
            kept.insert(key.into(), value.clone());
        }
    }
    // Typed input is secret; a wait's text is page content the agent asked for.
    if let Some(text) = args.get("text").and_then(Value::as_str) {
        if tool == "browser_type" {
            kept.insert("text_len".into(), json!(text.chars().count()));
        } else {
            kept.insert("text".into(), json!(text));
        }
    }
    let error = result.as_ref().err().map(|error| format!("{error:#}"));
    let (chars, image_bytes) = match result {
        Ok(content) => content.iter().fold((0, 0), |(chars, bytes), item| {
            let text = item.get("text").and_then(Value::as_str).unwrap_or("");
            let data = item.get("data").and_then(Value::as_str).unwrap_or("");
            let padding = data.bytes().rev().take_while(|b| *b == b'=').count();
            let decoded = (data.len() / 4 * 3).saturating_sub(padding);
            (chars + text.chars().count(), bytes + decoded)
        }),
        Err(_) => (
            "Error: ".len() + error.as_deref().unwrap_or("").chars().count(),
            0,
        ),
    };
    let mut entry = json!({
        "task": task,
        "tool": tool,
        "args": kept,
        "ok": result.is_ok(),
        "chars": chars,
        "image_bytes": image_bytes,
    });
    if let Some(error) = error {
        entry["error"] = json!(error.chars().take(300).collect::<String>());
    }
    entry
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    #[test]
    fn a_line_keeps_ref_and_url_but_only_the_length_of_typed_text() {
        let args = json!({ "ref": "e3", "text": "hunter2", "submit": true });
        let content = Ok(vec![json!({ "type": "text", "text": "abcd" })]);
        let entry = line("t_1", "browser_type", &args, &content);
        assert_eq!(
            entry["args"],
            json!({ "ref": "e3", "submit": true, "text_len": 7 })
        );
        assert!(!entry.to_string().contains("hunter2"));
        assert_eq!(entry["chars"], 4);
        assert_eq!(entry["ok"], true);
    }

    #[test]
    fn a_screenshot_counts_decoded_image_bytes_and_an_error_counts_its_message() {
        let shot = Ok(vec![
            json!({ "type": "text", "text": "ab" }),
            json!({ "type": "image", "data": "AAAAAA==", "mimeType": "image/png" }),
        ]);
        let entry = line("t_1", "browser_screenshot", &json!({}), &shot);
        assert_eq!(
            (entry["chars"].as_u64(), entry["image_bytes"].as_u64()),
            (Some(2), Some(4))
        );

        let failed = line(
            "t_1",
            "browser_click",
            &json!({ "ref": "e9" }),
            &Err(anyhow!("nope")),
        );
        assert_eq!(failed["ok"], false);
        assert_eq!(failed["chars"], "Error: nope".len());
        assert_eq!(failed["error"], "nope");
    }

    #[test]
    fn a_wait_line_keeps_page_text_and_its_condition_keys() {
        let args = json!({ "text": "Saved", "timeout_ms": 3000 });
        let entry = line("t_1", "browser_wait", &args, &Ok(vec![]));
        assert_eq!(
            entry["args"],
            json!({ "text": "Saved", "timeout_ms": 3000 })
        );

        let gone = line(
            "t_1",
            "browser_wait",
            &json!({ "gone": "Loading", "ref_gone": "e2" }),
            &Ok(vec![]),
        );
        assert_eq!(gone["args"], json!({ "gone": "Loading", "ref_gone": "e2" }));
    }

    #[test]
    fn scroll_press_and_headings_arguments_are_kept() {
        let scroll = line(
            "t_1",
            "browser_scroll",
            &json!({ "to": "bottom", "pages": -2 }),
            &Ok(vec![]),
        );
        assert_eq!(scroll["args"], json!({ "to": "bottom", "pages": -2 }));

        let press = line(
            "t_1",
            "browser_press",
            &json!({ "key": "Escape", "ref": "e5" }),
            &Ok(vec![]),
        );
        assert_eq!(press["args"], json!({ "key": "Escape", "ref": "e5" }));

        let headings = line(
            "t_1",
            "browser_snapshot",
            &json!({ "headings": true }),
            &Ok(vec![]),
        );
        assert_eq!(headings["args"], json!({ "headings": true }));
    }

    #[test]
    fn a_snapshot_line_keeps_interactive_and_scope_and_truncates_a_long_error() {
        let args = json!({ "interactive": true, "scope": "e4" });
        let entry = line("t_1", "browser_snapshot", &args, &Ok(vec![]));
        assert_eq!(entry["args"], json!({ "interactive": true, "scope": "e4" }));

        let long = "x".repeat(400);
        let failed = line(
            "t_1",
            "browser_click",
            &json!({ "ref": "e9" }),
            &Err(anyhow!(long)),
        );
        assert_eq!(failed["error"].as_str().unwrap().chars().count(), 300);
    }
}
