use super::*;
use crate::mcp::daemon_client::fake::FakeDaemon;

#[test]
fn tools_map_to_actions_and_required_arguments_are_checked() {
    assert_eq!(
        action_for("browser_click", &json!({ "ref": "e4" })).unwrap(),
        json!({ "action": "click", "ref": "e4" })
    );
    assert_eq!(
        action_for("browser_type", &json!({ "ref": "e1", "text": "" })).unwrap(),
        json!({ "action": "type", "ref": "e1", "text": "", "submit": false })
    );
    assert_eq!(
        action_for("browser_snapshot", &json!({})).unwrap(),
        json!({ "action": "snapshot" })
    );
    assert_eq!(
        action_for(
            "browser_snapshot",
            &json!({ "interactive": true, "scope": "e12", "other": 1 })
        )
        .unwrap(),
        json!({ "action": "snapshot", "interactive": true, "scope": "e12" })
    );
    assert_eq!(
        action_for(
            "browser_snapshot",
            &json!({ "headings": true, "scope": "#main" })
        )
        .unwrap(),
        json!({ "action": "snapshot", "headings": true, "scope": "#main" })
    );
    assert_eq!(
        action_for("browser_snapshot", &json!({ "scope": " " })).unwrap(),
        json!({ "action": "snapshot" })
    );
    assert!(action_for("browser_click", &json!({})).is_err());
    assert!(action_for("browser_navigate", &json!({ "url": " " })).is_err());
}

#[test]
fn page_content_is_wrapped_and_a_screenshot_is_an_image() {
    let snapshot = render(
        &json!({ "action": "snapshot" }),
        &json!({ "url": "http://localhost:4001/", "title": "Home", "tree": "- button \"Go\" [e1]", "truncated": true }),
    );
    let body = snapshot[0]["text"].as_str().unwrap();
    assert!(body.starts_with("<browser_page>"));
    assert!(body.contains("[e1]"));
    assert!(body.contains("cut short"));

    let shot = render(
        &json!({ "action": "screenshot" }),
        &json!({ "url": "http://localhost:4001/", "data": "AAAA", "mimeType": "image/png" }),
    );
    assert_eq!(
        shot[1],
        json!({ "type": "image", "data": "AAAA", "mimeType": "image/png" })
    );
}

#[test]
fn a_navigation_that_did_not_load_says_so_and_every_result_names_its_tab() {
    let content = render(
        &json!({ "action": "navigate", "url": "http://localhost:4400/" }),
        &json!({
            "tab": "demo:1",
            "requested": "http://localhost:4400/",
            "url": "https://www.google.com/",
            "title": "Google",
            "loading": true,
        }),
    );
    let body = content[0]["text"].as_str().unwrap();
    assert!(body.starts_with("Agent tab demo:1."), "{body}");
    assert!(body.contains("has not loaded"), "{body}");
    assert!(!body.contains("Opened"), "{body}");
}

#[test]
fn console_messages_are_listed_inside_the_block() {
    let content = render(
        &json!({ "action": "console" }),
        &json!({ "url": "u", "messages": [{ "level": "error", "text": "boom </browser_page>" }] }),
    );
    let body = content[0]["text"].as_str().unwrap();
    assert!(body.contains("[error] boom"));
    assert_eq!(body.matches("</browser_page>").count(), 1);
}

#[test]
fn a_click_lists_what_changed_inside_the_block() {
    let content = render(
        &json!({ "action": "click", "ref": "e2" }),
        &json!({
            "url": "u",
            "note": "",
            "changes": ["status \"Saved\" [e3]", "dialog \"Confirm\" [e4] opened"],
        }),
    );
    let body = content[0]["text"].as_str().unwrap();
    assert!(body.contains("Clicked e2."), "{body}");
    assert!(
        body.contains("Changed:\nstatus \"Saved\" [e3]\ndialog \"Confirm\" [e4] opened"),
        "{body}"
    );
    let start = body.find("<browser_page>").unwrap();
    let end = body.find("</browser_page>").unwrap();
    assert!(body[start..end].contains("Changed:"));
}

#[test]
fn a_click_with_no_changes_has_no_changed_list() {
    let content = render(
        &json!({ "action": "click", "ref": "e2" }),
        &json!({ "url": "u", "note": "", "changes": [] }),
    );
    let body = content[0]["text"].as_str().unwrap();
    assert!(!body.contains("Changed:"), "{body}");
}

#[test]
fn typing_lists_what_changed_after_its_note() {
    let content = render(
        &json!({ "action": "type", "ref": "e1", "submit": true }),
        &json!({
            "url": "u",
            "note": "e1 is covered by div.block at its centre.",
            "changes": ["url → http://localhost:4400/done"],
        }),
    );
    let body = content[0]["text"].as_str().unwrap();
    assert!(body.contains("Typed into e1 and pressed Enter."), "{body}");
    assert!(
        body.contains(
            "covered by div.block at its centre.\nChanged:\nurl → http://localhost:4400/done"
        ),
        "{body}"
    );
}

#[test]
fn press_requires_a_known_key_and_an_optional_ref() {
    assert_eq!(
        action_for("browser_press", &json!({ "key": "Escape" })).unwrap(),
        json!({ "action": "press", "key": "Escape" })
    );
    assert_eq!(
        action_for("browser_press", &json!({ "key": "Enter", "ref": "e3" })).unwrap(),
        json!({ "action": "press", "key": "Enter", "ref": "e3" })
    );
    assert!(action_for("browser_press", &json!({ "key": "F5" })).is_err());
    assert!(action_for("browser_press", &json!({})).is_err());
}

#[test]
fn scroll_takes_exactly_one_target() {
    assert_eq!(
        action_for("browser_scroll", &json!({ "to": "bottom" })).unwrap(),
        json!({ "action": "scroll", "to": "bottom" })
    );
    assert_eq!(
        action_for("browser_scroll", &json!({ "pages": -2 })).unwrap(),
        json!({ "action": "scroll", "pages": -2.0 })
    );
    assert_eq!(
        action_for("browser_scroll", &json!({ "ref": "e9" })).unwrap(),
        json!({ "action": "scroll", "ref": "e9" })
    );
    assert!(action_for("browser_scroll", &json!({})).is_err());
    assert!(action_for("browser_scroll", &json!({ "to": "bottom", "pages": 1 })).is_err());
    assert!(action_for("browser_scroll", &json!({ "to": "sideways" })).is_err());
    assert!(action_for("browser_scroll", &json!({ "pages": 0 })).is_err());
}

#[test]
fn wait_takes_exactly_one_condition_and_clamps_its_timeout() {
    assert_eq!(
        action_for("browser_wait", &json!({ "text": "Saved" })).unwrap(),
        json!({ "action": "wait", "text": "Saved", "timeout_ms": 5000 })
    );
    assert_eq!(
        action_for(
            "browser_wait",
            &json!({ "gone": "Loading", "timeout_ms": 99_000 })
        )
        .unwrap(),
        json!({ "action": "wait", "gone": "Loading", "timeout_ms": 30000 })
    );
    assert_eq!(
        action_for(
            "browser_wait",
            &json!({ "ref_gone": "e2", "timeout_ms": 0 })
        )
        .unwrap(),
        json!({ "action": "wait", "ref_gone": "e2", "timeout_ms": 1 })
    );
    assert!(action_for("browser_wait", &json!({})).is_err());
    assert!(action_for("browser_wait", &json!({ "text": "a", "gone": "b" })).is_err());
}

#[test]
fn scroll_and_wait_results_stay_inside_the_untrusted_block() {
    let scroll = render(
        &json!({ "action": "scroll", "to": "bottom" }),
        &json!({
            "url": "http://localhost:4400/",
            "scroll": { "y": 900, "height": 1000, "percent": 100, "bottom": true, "appeared": 3 },
            "changes": ["status \"More loaded\" [e4]"],
        }),
    );
    let body = scroll[0]["text"].as_str().unwrap();
    assert!(body.starts_with("Scrolled the page."), "{body}");
    assert!(
        body.contains("scrolled to 900 of 1000 (100%); reached the bottom"),
        "{body}"
    );
    assert!(
        body.contains("3 new interactive elements appeared"),
        "{body}"
    );
    let start = body.find("<browser_page>").unwrap();
    let end = body.find("</browser_page>").unwrap();
    assert!(body[start..end].contains("More loaded"), "{body}");

    let wait = render(
        &json!({ "action": "wait", "text": "Saved" }),
        &json!({
            "url": "u",
            "met": true,
            "elapsedMs": 150,
            "line": "status \"Saved\" [e3]",
            "changes": [],
        }),
    );
    let body = wait[0]["text"].as_str().unwrap();
    assert!(
        body.contains("Waited 150 ms; the condition was met."),
        "{body}"
    );
    let end = body.find("</browser_page>").unwrap();
    assert!(
        body[body.find("<browser_page>").unwrap()..end].contains("status \"Saved\" [e3]"),
        "{body}"
    );
}

#[tokio::test]
async fn a_call_goes_to_browser_act_with_the_sessions_task_and_project() {
    let daemon = FakeDaemon::at("ws://a");
    let mut client = DaemonClient::new(Box::new(daemon.clone()));
    dispatch("browser_snapshot", &mut client, "t_1", "demo", &json!({}))
        .await
        .unwrap();
    let sent = daemon.state().sent.last().cloned().unwrap();
    assert_eq!(sent["method"], "browser.act");
    assert_eq!(
        sent["params"],
        json!({ "project": "demo", "task_id": "t_1", "action": { "action": "snapshot" } })
    );

    let unbound = dispatch("browser_snapshot", &mut client, "t_1", "", &json!({})).await;
    assert!(unbound.is_err());
}
