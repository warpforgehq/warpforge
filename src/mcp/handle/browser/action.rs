use anyhow::{anyhow, Result};
use serde_json::{json, Value};

// The order the enum in src/mcp/tools/browser.rs lists them in.
fn text_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| anyhow!("'{key}' is required"))
}

fn snapshot_action(args: &Value) -> Value {
    let mut action = json!({ "action": "snapshot" });
    if let Some(interactive) = args.get("interactive").and_then(Value::as_bool) {
        action["interactive"] = json!(interactive);
    }
    if let Some(headings) = args.get("headings").and_then(Value::as_bool) {
        action["headings"] = json!(headings);
    }
    if let Some(scope) = args
        .get("scope")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        action["scope"] = json!(scope);
    }
    action
}

const PRESS_KEYS: &[&str] = &[
    "Enter",
    "Escape",
    "Tab",
    "Shift+Tab",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    "Backspace",
    "Delete",
];

fn optional_text<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
}

fn press_action(args: &Value) -> Result<Value> {
    let key = text_arg(args, "key")?;
    if !PRESS_KEYS.contains(&key) {
        return Err(anyhow!("'key' must be one of {}", PRESS_KEYS.join(", ")));
    }
    let mut action = json!({ "action": "press", "key": key });
    if let Some(target) = optional_text(args, "ref") {
        action["ref"] = json!(target);
    }
    Ok(action)
}

fn scroll_action(args: &Value) -> Result<Value> {
    let target = optional_text(args, "ref");
    let to = optional_text(args, "to");
    let pages = args.get("pages").and_then(Value::as_f64);
    if args.get("pages").is_some() && pages.is_none() {
        return Err(anyhow!("'pages' must be a number"));
    }
    let given =
        usize::from(target.is_some()) + usize::from(to.is_some()) + usize::from(pages.is_some());
    if given != 1 {
        return Err(anyhow!("give exactly one of 'ref', 'to' or 'pages'"));
    }
    let mut action = json!({ "action": "scroll" });
    if let Some(target) = target {
        action["ref"] = json!(target);
    }
    if let Some(to) = to {
        if to != "top" && to != "bottom" {
            return Err(anyhow!("'to' must be 'top' or 'bottom'"));
        }
        action["to"] = json!(to);
    }
    if let Some(pages) = pages {
        if !pages.is_finite() || pages == 0.0 {
            return Err(anyhow!("'pages' must be a non-zero number"));
        }
        action["pages"] = json!(pages);
    }
    Ok(action)
}

fn wait_action(args: &Value) -> Result<Value> {
    let text = optional_text(args, "text");
    let gone = optional_text(args, "gone");
    let ref_gone = optional_text(args, "ref_gone");
    let given =
        usize::from(text.is_some()) + usize::from(gone.is_some()) + usize::from(ref_gone.is_some());
    if given != 1 {
        return Err(anyhow!("give exactly one of 'text', 'gone' or 'ref_gone'"));
    }
    if args.get("timeout_ms").is_some() && args.get("timeout_ms").and_then(Value::as_u64).is_none()
    {
        return Err(anyhow!("'timeout_ms' must be a whole number"));
    }
    let timeout = args
        .get("timeout_ms")
        .and_then(Value::as_u64)
        .unwrap_or(5_000)
        .clamp(1, 30_000);
    let mut action = json!({ "action": "wait", "timeout_ms": timeout });
    if let Some(text) = text {
        action["text"] = json!(text);
    }
    if let Some(gone) = gone {
        action["gone"] = json!(gone);
    }
    if let Some(ref_gone) = ref_gone {
        action["ref_gone"] = json!(ref_gone);
    }
    Ok(action)
}

pub(super) fn action_for(name: &str, args: &Value) -> Result<Value> {
    Ok(match name {
        "browser_snapshot" => snapshot_action(args),
        "browser_click" => json!({ "action": "click", "ref": text_arg(args, "ref")? }),
        "browser_type" => json!({
            "action": "type",
            "ref": text_arg(args, "ref")?,
            "text": args.get("text").and_then(Value::as_str).ok_or_else(|| anyhow!("'text' is required"))?,
            "submit": args.get("submit").and_then(Value::as_bool).unwrap_or(false),
        }),
        "browser_press" => press_action(args)?,
        "browser_scroll" => scroll_action(args)?,
        "browser_wait" => wait_action(args)?,
        "browser_navigate" => json!({ "action": "navigate", "url": text_arg(args, "url")? }),
        "browser_screenshot" => json!({ "action": "screenshot" }),
        "browser_console" => json!({ "action": "console" }),
        other => return Err(anyhow!("unknown tool: {other}")),
    })
}
