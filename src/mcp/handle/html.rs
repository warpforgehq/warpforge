use std::time::Duration;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use warpforge_protocol::html_render as limits;

use crate::mcp::daemon_client::DaemonClient;

/// Longer than the daemon gives the desktop, so its own explanation of a
/// slow preview arrives instead of a bare timeout.
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(45);

pub(crate) fn is_html_tool(name: &str) -> bool {
    matches!(name, "render_html" | "render_preview")
}

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    task: &str,
    args: &Value,
) -> Result<Vec<Value>> {
    let html = args
        .get("html")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("'html' is required"))?;
    limits::validate_html(html).map_err(|e| anyhow!(e))?;
    if name == "render_preview" {
        let result = client
            .request_within(
                "html.preview",
                json!({
                    "task_id": task,
                    "html": html,
                    "width": args.get("width").and_then(Value::as_i64),
                    "appearance": args.get("appearance").and_then(Value::as_str),
                }),
                PREVIEW_TIMEOUT,
            )
            .await?;
        return Ok(preview_content(&result));
    }
    if task.is_empty() {
        return Err(anyhow!("render_html needs a Warpforge task session"));
    }
    let title = args
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("'title' is required"))?;
    let title = limits::validate_title(title).map_err(|e| anyhow!(e))?;
    let height = args
        .get("height")
        .and_then(Value::as_f64)
        .ok_or_else(|| anyhow!("'height' is required"))?;
    client
        .request(
            "html.render",
            json!({
                "task_id": task,
                "html": html,
                "title": title,
                "height": limits::clamp_height(height),
            }),
        )
        .await?;
    Ok(vec![json!({
        "type": "text",
        "text": format!(
            "Shown to the user above your reply as \"{title}\". Don't mention, describe or \
             restate the page; reply with only what it doesn't already say."
        ),
    })])
}

fn number(result: &Value, key: &str) -> i64 {
    result.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn preview_content(result: &Value) -> Vec<Value> {
    let appearance = result
        .get("appearance")
        .and_then(Value::as_str)
        .unwrap_or("app");
    let mut text = format!(
        "Preview at {}px ({appearance}): contentHeight {}px, captured {}px.",
        number(result, "width"),
        number(result, "contentHeight"),
        number(result, "capturedHeight"),
    );
    let messages: Vec<String> = result
        .get("messages")
        .and_then(Value::as_array)
        .map(|messages| {
            messages
                .iter()
                .map(|m| {
                    let field = |key| m.get(key).and_then(Value::as_str).unwrap_or("");
                    format!("[{}] {}", field("level"), field("text"))
                })
                .collect()
        })
        .unwrap_or_default();
    if messages.is_empty() {
        text.push_str("\nNo console errors or warnings.");
    } else {
        text.push_str("\nConsole:\n");
        text.push_str(&messages.join("\n"));
    }
    let mut content = vec![json!({ "type": "text", "text": text })];
    if let Some(data) = result.get("data").and_then(Value::as_str) {
        content.push(json!({ "type": "image", "data": data, "mimeType": "image/png" }));
    }
    content
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::daemon_client::fake::FakeDaemon;

    fn client(daemon: &FakeDaemon) -> DaemonClient {
        DaemonClient::new(Box::new(daemon.clone()))
    }

    #[tokio::test]
    async fn render_html_sends_the_task_and_a_clamped_height() {
        let daemon = FakeDaemon::at("ws://a");
        let mut client = client(&daemon);
        let content = dispatch(
            "render_html",
            &mut client,
            "t_1",
            &json!({ "html": "<p>x</p>", "title": " Chart ", "height": 99999 }),
        )
        .await
        .unwrap();
        let sent = daemon.state().sent.last().cloned().unwrap();
        assert_eq!(sent["method"], "html.render");
        assert_eq!(
            sent["params"],
            json!({ "task_id": "t_1", "html": "<p>x</p>", "title": "Chart", "height": 2000 })
        );
        let text = content[0]["text"].as_str().unwrap();
        assert!(
            text.contains("\"Chart\"") && text.contains("Don't mention"),
            "{text}"
        );
    }

    #[tokio::test]
    async fn bad_arguments_are_refused_before_anything_is_sent() {
        let daemon = FakeDaemon::at("ws://a");
        let mut client = client(&daemon);
        let too_big = "a".repeat(limits::MAX_HTML_BYTES + 1);
        for args in [
            json!({ "html": too_big, "title": "T", "height": 300 }),
            json!({ "html": "<p>x</p>", "title": "  ", "height": 300 }),
            json!({ "html": "<p>x</p>", "title": "T" }),
            json!({ "title": "T", "height": 300 }),
        ] {
            assert!(dispatch("render_html", &mut client, "t_1", &args)
                .await
                .is_err());
        }
        let unbound = dispatch(
            "render_html",
            &mut client,
            "",
            &json!({ "html": "<p>x</p>", "title": "T", "height": 300 }),
        )
        .await;
        assert!(unbound.is_err());
        assert!(daemon.state().sent.is_empty());
    }

    #[tokio::test]
    async fn a_preview_is_text_then_the_screenshot() {
        let daemon = FakeDaemon::at("ws://a");
        daemon.state().results.insert(
            "html.preview".into(),
            vec![json!({
                "data": "iVBO",
                "width": 390,
                "contentHeight": 512,
                "capturedHeight": 512,
                "appearance": "light",
                "messages": [{ "level": "error", "text": "x is not defined" }],
            })]
            .into(),
        );
        let mut client = client(&daemon);
        let content = dispatch(
            "render_preview",
            &mut client,
            "t_1",
            &json!({ "html": "<p>x</p>", "width": 390, "appearance": "light" }),
        )
        .await
        .unwrap();
        let sent = daemon.state().sent.last().cloned().unwrap();
        assert_eq!(sent["method"], "html.preview");
        assert_eq!(sent["params"]["width"], 390);
        let text = content[0]["text"].as_str().unwrap();
        assert!(
            text.starts_with("Preview at 390px (light): contentHeight 512px"),
            "{text}"
        );
        assert!(text.contains("[error] x is not defined"), "{text}");
        assert_eq!(
            content[1],
            json!({ "type": "image", "data": "iVBO", "mimeType": "image/png" })
        );
    }

    #[test]
    fn a_clean_preview_says_so() {
        let content = preview_content(&json!({ "width": 720, "contentHeight": 300 }));
        let text = content[0]["text"].as_str().unwrap();
        assert!(text.contains("No console errors or warnings."), "{text}");
        assert_eq!(content.len(), 1);
    }
}
