use serde_json::{json, Value};

use crate::mcp::untrusted::browser_page;

fn text(value: String) -> Value {
    json!({ "type": "text", "text": value })
}

fn field<'a>(result: &'a Value, key: &str) -> &'a str {
    result.get(key).and_then(Value::as_str).unwrap_or("")
}

/// The page-derived "Changed:" list, empty when the action reported nothing.
fn changed(result: &Value) -> String {
    let lines: Vec<&str> = result
        .get("changes")
        .and_then(Value::as_array)
        .map(|changes| {
            changes
                .iter()
                .filter_map(Value::as_str)
                .filter(|line| !line.trim().is_empty())
                .collect()
        })
        .unwrap_or_default();
    if lines.is_empty() {
        String::new()
    } else {
        format!("Changed:\n{}", lines.join("\n"))
    }
}

/// What the action reported, followed by what changed, inside the block.
fn with_changed(report: &str, result: &Value) -> String {
    let changed = changed(result);
    match (report.is_empty(), changed.is_empty()) {
        (_, true) => report.to_string(),
        (true, false) => changed,
        (false, false) => format!("{report}\n{changed}"),
    }
}

fn body(note: &str, result: &Value) -> String {
    with_changed(note, result)
}

/// Turn the desktop's result into MCP content. Everything the page produced
/// goes inside the untrusted block; only the tool's own verdict stays outside.
pub(super) fn render(action: &Value, result: &Value) -> Vec<Value> {
    let mut content = render_page(action, result);
    let tab = field(result, "tab");
    if let (false, Some(first)) = (tab.is_empty(), content.first_mut()) {
        if let Some(text) = first.get("text").and_then(Value::as_str) {
            *first = self::text(format!("Agent tab {tab}.\n{text}"));
        }
    }
    content
}

fn render_page(action: &Value, result: &Value) -> Vec<Value> {
    let url = field(result, "url");
    let title = field(result, "title");
    let target = field(action, "ref");
    let page = |body: &str| browser_page(url, title, body);
    match field(action, "action") {
        "snapshot" => {
            let mut body = field(result, "tree").to_string();
            if result.get("truncated").and_then(Value::as_bool) == Some(true) {
                body.push_str("\n… the outline was cut short; the page has more.");
            }
            vec![text(page(&body))]
        }
        "click" => vec![text(format!(
            "Clicked {target}.\n{}",
            page(&body(field(result, "note"), result))
        ))],
        "type" => {
            let submitted = if action.get("submit").and_then(Value::as_bool) == Some(true) {
                " and pressed Enter"
            } else {
                ""
            };
            vec![text(format!(
                "Typed into {target}{submitted}.\n{}",
                page(&body(field(result, "note"), result))
            ))]
        }
        "press" => {
            let key = field(action, "key");
            let target = if target.is_empty() {
                "the page"
            } else {
                target
            };
            vec![text(format!(
                "Pressed {key} on {target}.\n{}",
                page(&body(field(result, "note"), result))
            ))]
        }
        "scroll" => {
            let mut report = String::new();
            if let Some(scroll) = result.get("scroll") {
                let number = |key: &str| scroll.get(key).and_then(Value::as_f64).unwrap_or(0.0);
                report = format!(
                    "scrolled to {} of {} ({}%)",
                    number("y") as i64,
                    number("height") as i64,
                    number("percent") as i64
                );
                if scroll.get("bottom").and_then(Value::as_bool) == Some(true) {
                    report.push_str("; reached the bottom");
                }
                let appeared = number("appeared") as i64;
                if appeared > 0 {
                    report.push_str(&format!(
                        "\n{appeared} new interactive elements appeared; take a new browser_snapshot"
                    ));
                }
            }
            let target = if target.is_empty() {
                "the page"
            } else {
                target
            };
            vec![text(format!(
                "Scrolled {target}.\n{}",
                page(&with_changed(&report, result))
            ))]
        }
        "wait" => {
            let elapsed = result.get("elapsedMs").and_then(Value::as_u64).unwrap_or(0);
            let verdict = if result.get("met").and_then(Value::as_bool) == Some(true) {
                format!("Waited {elapsed} ms; the condition was met.")
            } else {
                format!("Waited {elapsed} ms; the condition was not met before the timeout.")
            };
            let report = field(result, "line");
            vec![text(format!(
                "{verdict}\n{}",
                page(&with_changed(report, result))
            ))]
        }
        "navigate" => {
            let requested = field(result, "requested");
            let mut verdict = if result.get("loading").and_then(Value::as_bool) == Some(true) {
                format!(
                    "{requested} has not loaded: it may be slow or unreachable (check list_runtime \
                     and the service logs). The tab still shows the page below."
                )
            } else {
                format!("Opened {requested}.")
            };
            if result.get("unapproved").and_then(Value::as_bool) == Some(true) {
                verdict.push_str(
                    " The page ended up on a site that is not approved; its content stays hidden \
                     until the next action asks the user.",
                );
            }
            vec![text(format!("{verdict}\n{}", page("")))]
        }
        "screenshot" => {
            let mut content = vec![text(page(""))];
            let evidence = field(result, "evidence");
            if !evidence.is_empty() {
                content.insert(
                    0,
                    text(format!(
                        "Kept as verification evidence: {evidence}. Cite this name in your checklist."
                    )),
                );
            }
            let data = field(result, "data");
            if !data.is_empty() {
                let mime = match field(result, "mimeType") {
                    "" => "image/jpeg",
                    mime => mime,
                };
                content.push(json!({ "type": "image", "data": data, "mimeType": mime }));
            }
            content
        }
        "console" => {
            let lines: Vec<String> = result
                .get("messages")
                .and_then(Value::as_array)
                .map(|messages| {
                    messages
                        .iter()
                        .map(|m| format!("[{}] {}", field(m, "level"), field(m, "text")))
                        .collect()
                })
                .unwrap_or_default();
            let body = if lines.is_empty() {
                "No console messages since the page loaded.".to_string()
            } else {
                lines.join("\n")
            };
            vec![text(page(&body))]
        }
        _ => vec![text(page(&result.to_string()))],
    }
}
