use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

use serde_json::json;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};
use warpforge_protocol as wire;

use super::edits::{line_change_counts, line_change_hunks};
use super::model::{resolve_model_apply, ModelApply};
use super::process::{
    append_stderr_chunk, is_session_gone, sanitize_stderr, ChildState, ProcessGuard,
    STDERR_LINE_BYTES, STDERR_TOTAL_BYTES,
};
use super::session::parse_permission;
use super::tool::tool_title;
use super::update::parse_update;
use super::*;
use crate::daemon::prompt::{PreparedPrompt, PromptContent};

fn option(id: &str, name: &str, category: Option<&str>, current_value: &str) -> wire::ConfigOption {
    wire::ConfigOption {
        id: id.into(),
        name: name.into(),
        category: category.map(String::from),
        current_value: current_value.into(),
        options: Vec::new(),
    }
}

/// The picker heuristic must survive claude's `model_config` category:
/// `Fast mode` is an on/off toggle, never the model selector.
#[test]
fn model_config_toggle_is_never_the_model_selector() {
    // What claude-agent-acp advertises.
    let fast = option("fast", "Fast mode", Some("model_config"), "off");
    assert!(!is_model_selector(&fast));

    // The real selector, in the shapes agents actually use.
    assert!(is_model_selector(&option(
        "model",
        "Model",
        Some("model"),
        "sonnet"
    )));
    assert!(is_model_selector(&option(
        "modelId", "Model", None, "sonnet"
    )));
    // The degenerate case: the ONLY model-ish option is a model_config
    // toggle. We must not set it; the intent stays unapplied (log only).
    let options = vec![fast];
    assert!(matches!(
        resolve_model_apply(Some("opus"), &options),
        ModelApply::UnknownSelector
    ));
}

#[test]
fn model_apply_decision() {
    let selector = option("model", "Model", Some("model"), "sonnet");
    let mode = option("mode", "Permission mode", Some("mode"), "ask");
    let options = vec![mode.clone(), selector.clone()];

    // No intent: hands-off on fresh and resume alike.
    assert!(matches!(
        resolve_model_apply(None, &options),
        ModelApply::Keep
    ));
    // Intent matching the live value: nothing to set.
    assert!(matches!(
        resolve_model_apply(Some("sonnet"), &options),
        ModelApply::Keep
    ));
    // Intent differing: target the model selector's id, not the mode's.
    match resolve_model_apply(Some("opus"), &options) {
        ModelApply::Set { config_id, value } => {
            assert_eq!(config_id, "model");
            assert_eq!(value, "opus");
        }
        _ => panic!("expected Set"),
    }
    // Selector not advertised yet (late config_option_update): never a
    // mismatch, just leave the session alone.
    let no_selector = vec![mode];
    assert!(matches!(
        resolve_model_apply(Some("opus"), &no_selector),
        ModelApply::UnknownSelector
    ));
}

/// A "session gone" verdict throws the saved session id away, so it must
/// fire only when the agent really has forgotten *that* session.
#[test]
fn only_a_missing_session_counts_as_gone() {
    let sid = "aac83a02-3541-4dfd-8257-730dd547476a";

    // What claude-agent-acp actually returns.
    assert!(is_session_gone(
        &json!({"error": {"code": -32002, "message": format!("Resource not found: {sid}"),
                          "data": {"uri": sid}}}),
        sid
    ));
    // No code, but the message names the session.
    assert!(is_session_gone(
        &json!({"error": {"message": format!("session {sid} not found")}}),
        sid
    ));
    // A missing working directory is recoverable — keep the id.
    assert!(!is_session_gone(
        &json!({"error": {"message": "cwd not found: /gone/worktree"}}),
        sid
    ));
    // Any other rejection leaves the session alone.
    assert!(!is_session_gone(
        &json!({"error": {"code": -32603, "message": "internal error"}}),
        sid
    ));
    assert!(!is_session_gone(&json!({"result": {}}), sid));
}

#[test]
fn mcp_tool_titles_render_as_human_labels() {
    // Claude convention.
    assert_eq!(
        pretty_mcp_tool_label("mcp__warpforge__list_runtime"),
        "List runtime"
    );
    // opencode convention (server_tool, no mcp__ prefix).
    assert_eq!(
        pretty_mcp_tool_label("warpforge_read_service_logs"),
        "Read service logs"
    );
    // Not MCP-shaped — leave untouched.
    assert_eq!(pretty_mcp_tool_label("Read file"), "Read file");
}

#[test]
fn spawn_agent_title_surfaces_the_agent_and_task() {
    // opencode convention.
    let update = json!({
        "title": "warpforge_spawn_agent",
        "rawInput": { "agent": "codex", "task": "Refactor the auth module" }
    });
    assert_eq!(
        tool_title(&update, "call-1", "other"),
        "Spawn agent codex: Refactor the auth module"
    );
}

#[test]
fn permission_title_prettifies_mcp_names() {
    let (title, options, _map, _tool_call_id) = parse_permission(&json!({
        "toolCall": { "title": "mcp__warpforge__service_start" },
        "options": []
    }));
    assert_eq!(title, "Service start");
    assert!(options.is_empty());
}

/// The prompt and the tool row are one event, so the id that joins them
/// has to survive parsing. An agent that names no tool call still asks.
#[test]
fn permission_carries_the_tool_call_it_gates() {
    let (_title, _options, _map, tool_call_id) = parse_permission(&json!({
        "toolCall": { "title": "Bash", "toolCallId": "exec-42" },
        "options": []
    }));
    assert_eq!(tool_call_id.as_deref(), Some("exec-42"));

    let (_title, _options, _map, missing) = parse_permission(&json!({ "options": [] }));
    assert_eq!(missing, None);
}

fn test_process_guard() -> Arc<ProcessGuard> {
    let (kill_tx, _kill_rx) = mpsc::unbounded_channel();
    Arc::new(ProcessGuard {
        kill_tx,
        stopping: Arc::new(AtomicBool::new(false)),
    })
}

fn empty_prompt() -> PreparedPrompt {
    PreparedPrompt {
        content: Vec::new(),
        summaries: Vec::new(),
        has_images: false,
    }
}

#[test]
fn tool_call_uses_raw_command_instead_of_technical_id() {
    let params = json!({
        "update": {
            "sessionUpdate": "tool_call",
            "toolCallId": "exec-7a8abe42-803f-447f-8a24-245cb383d4f9",
            "kind": "execute",
            "status": "in_progress",
            "rawInput": { "command": "git diff --stat" }
        }
    });

    let Some(AcpUpdate::ToolCall { title, content, .. }) = parse_update(&params) else {
        panic!("expected tool call");
    };
    assert_eq!(title, "git diff --stat");
    assert_eq!(
        content.as_deref(),
        Some("{\n  \"command\": \"git diff --stat\"\n}")
    );
}

#[test]
fn tool_call_exposes_raw_output_and_never_falls_back_to_id() {
    let params = json!({
        "update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "exec-0fd95cb1-b51a-4037-8300-bbf6c6597b5d",
            "kind": "execute",
            "status": "completed",
            "rawOutput": "3 files changed"
        }
    });

    let Some(AcpUpdate::ToolCall { title, content, .. }) = parse_update(&params) else {
        panic!("expected tool call");
    };
    assert_eq!(title, "Run command");
    assert_eq!(content.as_deref(), Some("3 files changed"));
}

#[test]
fn file_edit_reports_line_counts_from_acp_diff() {
    let params = json!({
        "update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "edit-1",
            "kind": "edit",
            "status": "completed",
            "content": [{
                "type": "diff",
                "path": "src/main.rs",
                "oldText": "use std::io;\n\nfn main() {\n    old();\n}\n",
                "newText": "use std::fs;\nuse std::io;\n\nfn main() {\n    new();\n}\n"
            }]
        }
    });

    let Some(AcpUpdate::FileEdit {
        path,
        tool_call_id,
        additions,
        deletions,
        hunks,
    }) = parse_update(&params)
    else {
        panic!("expected file edit");
    };
    assert_eq!(path, "src/main.rs");
    assert_eq!(tool_call_id, "edit-1");
    assert_eq!(additions, Some(2));
    assert_eq!(deletions, Some(1));
    assert_eq!(hunks.len(), 2);
    assert_eq!(
        (
            hunks[0].old_start,
            hunks[0].old_lines,
            hunks[0].new_start,
            hunks[0].new_lines,
        ),
        (1, 0, 1, 1)
    );
    assert_eq!(
        (
            hunks[1].old_start,
            hunks[1].old_lines,
            hunks[1].new_start,
            hunks[1].new_lines,
        ),
        (4, 1, 5, 1)
    );
    assert!(hunks[1].lines.contains(&"-    old();".to_string()));
    assert!(hunks[1].lines.contains(&"+    new();".to_string()));
}

#[test]
fn line_counts_handle_new_files_and_disjoint_edits() {
    assert_eq!(line_change_counts(None, "one\ntwo\n"), (2, 0));
    assert_eq!(line_change_counts(Some("one\ntwo\n"), ""), (0, 2));
    assert_eq!(line_change_counts(Some("same\n"), "same\n"), (0, 0));
    assert_eq!(
        line_change_counts(
            Some("keep\nold one\nmiddle\nold two\ntail\n"),
            "keep\nnew one\nmiddle\nnew two\nextra\ntail\n",
        ),
        (3, 2),
    );
    let hunks = line_change_hunks(
        Some("keep\nold one\nmiddle\nold two\ntail\n"),
        "keep\nnew one\nmiddle\nnew two\nextra\ntail\n",
    );
    assert_eq!(hunks.len(), 2);
    assert_eq!(
        (
            hunks[1].old_start,
            hunks[1].old_lines,
            hunks[1].new_start,
            hunks[1].new_lines,
        ),
        (4, 1, 4, 2)
    );
}

#[test]
fn parses_context_usage_and_optional_cost() {
    let params = json!({
        "update": {
            "sessionUpdate": "usage_update",
            "used": 53_000,
            "size": 200_000,
            "cost": { "amount": 0.045, "currency": "USD" }
        }
    });

    let Some(AcpUpdate::Usage { used, size, cost }) = parse_update(&params) else {
        panic!("expected usage update");
    };
    assert_eq!(used, 53_000);
    assert_eq!(size, 200_000);
    assert_eq!(cost.unwrap().currency, "USD");
}

#[test]
fn handle_enforces_negotiated_image_capability() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let (_exit_tx, exit_rx) = watch::channel(ChildState::Running);
    let capability = Arc::new(AtomicU8::new(1));
    let handle = AcpHandle {
        cmd_tx: tx,
        exit_rx,
        image_capability: Arc::clone(&capability),
        process: test_process_guard(),
        run_id: 1,
    };
    let prompt = PreparedPrompt {
        content: vec![PromptContent::Image {
            mime_type: "image/png".into(),
            data: "abc".into(),
        }],
        summaries: vec![],
        has_images: true,
    };
    assert!(handle.prompt(prompt.clone()).is_err());
    assert!(rx.try_recv().is_err());
    capability.store(2, Ordering::Release);
    assert!(handle.prompt(prompt).is_ok());
    assert!(matches!(rx.try_recv(), Ok(AcpCommand::Prompt(_))));
}

#[test]
fn stderr_is_control_sanitized_redacted_and_bounded() {
    let secret = b"use Authorization: Bearer super-secret\nnormal\x1b[31m diagnostic";
    let sanitized = sanitize_stderr(secret);
    assert!(!sanitized.contains("super-secret"));
    assert!(!sanitized.contains('\x1b'));
    assert!(sanitized.contains("[REDACTED]"));
    assert!(sanitized.contains("normal[31m diagnostic"));

    let mut captured = Vec::new();
    let mut line_bytes = 0;
    let mut input = vec![b'x'; STDERR_LINE_BYTES * 2];
    input.push(b'\n');
    input.extend(std::iter::repeat_n(b'y', STDERR_TOTAL_BYTES * 2));
    append_stderr_chunk(&mut captured, &mut line_bytes, &input);
    assert_eq!(
        captured.iter().position(|byte| *byte == b'\n'),
        Some(STDERR_LINE_BYTES)
    );
    assert!(captured.len() <= STDERR_TOTAL_BYTES);
    let invalid_utf8 = vec![0xff; STDERR_TOTAL_BYTES];
    let sanitized = sanitize_stderr(&invalid_utf8);
    assert!(sanitized.len() <= STDERR_LINE_BYTES);
}

#[tokio::test]
async fn child_exit_reports_once_with_status_and_safe_stderr() {
    let (updates, mut rx) = mpsc::unbounded_channel();
    let _handle = spawn_acp_session(
        "task".into(),
        "printf 'token=secret\\nuseful diagnostic\\n' >&2; exit 23".into(),
        ".".into(),
        empty_prompt(),
        None,
        Vec::new(),
        updates,
        None,
        None,
        std::collections::HashMap::new(),
        super::super::accounts::AgentEnv::default(),
    )
    .unwrap();

    let (
        _,
        AcpUpdate::Error {
            message: reason, ..
        },
    ) = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
        .await
        .expect("failure should be prompt")
        .expect("failure update")
    else {
        panic!("expected terminal error");
    };
    assert!(
        reason.contains("23"),
        "actual exit status missing: {reason}"
    );
    assert!(reason.contains("useful diagnostic"));
    assert!(!reason.contains("secret"));
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
        rx.try_recv().is_err(),
        "child failure must be reported once"
    );
}

/// The account switcher is only real if the selected account's home
/// actually reaches the agent process — and if inherited auth env is
/// actually gone from it. Assert both against the real child rather than
/// trusting `Command::envs` / `env_remove`.
#[cfg(unix)]
#[tokio::test]
async fn spawn_env_reaches_the_agent_process() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("env");
    let command = format!(
        "printf '%s|%s\\n' \"${{CODEX_HOME:-unset}}\" \"${{ANTHROPIC_API_KEY:-unset}}\" > {}; exec 1>&-",
        out_path.display()
    );
    let (updates, mut rx) = mpsc::unbounded_channel();
    // The daemon inherits a stale key; the child must not.
    std::env::set_var("ANTHROPIC_API_KEY", "inherited-key");
    let mut env = super::super::accounts::AgentEnv::default();
    env.set
        .insert("CODEX_HOME".to_string(), "/tmp/wf-account-home".to_string());
    env.remove.push("ANTHROPIC_API_KEY".to_string());
    let _handle = spawn_acp_session(
        "task".into(),
        command,
        dir.path().to_string_lossy().into_owned(),
        empty_prompt(),
        None,
        Vec::new(),
        updates,
        None,
        None,
        std::collections::HashMap::new(),
        env,
    )
    .unwrap();

    // Wait for the child to fail on closed stdout, by which point it has run.
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await;
    let seen = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Ok(value) = std::fs::read_to_string(&out_path) {
                if !value.trim().is_empty() {
                    break value.trim().to_string();
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("child should report its environment");
    std::env::remove_var("ANTHROPIC_API_KEY");
    assert_eq!(seen, "/tmp/wf-account-home|unset");
}

#[cfg(unix)]
#[tokio::test]
async fn closed_stdout_is_reported_without_waiting_for_initialize_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let pid_path = dir.path().join("pid");
    let command = format!("echo $$ > {}; exec 1>&-; sleep 30", pid_path.display());
    let (updates, mut rx) = mpsc::unbounded_channel();
    let handle = spawn_acp_session(
        "task".into(),
        command,
        dir.path().to_string_lossy().into_owned(),
        empty_prompt(),
        None,
        Vec::new(),
        updates,
        None,
        None,
        std::collections::HashMap::new(),
        super::super::accounts::AgentEnv::default(),
    )
    .unwrap();

    let (_, AcpUpdate::Error { message, .. }) =
        tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("closed stdout should fail promptly")
            .expect("failure update")
    else {
        panic!("expected terminal error");
    };
    assert!(message.contains("closed its ACP stdout"), "{message}");
    assert!(message.contains("exec 1>&-; sleep 30"), "{message}");

    let pid = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(&pid_path) {
                break pid.trim().to_string();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("child should write pid");
    handle.cancel();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let alive = Command::new("kill")
                .args(["-0", &pid])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .is_ok_and(|status| status.success());
            if !alive {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancel should kill the child before the test returns");
}

#[cfg(unix)]
#[tokio::test]
async fn dropping_last_handle_kills_child_process_group() {
    let dir = tempfile::tempdir().unwrap();
    let pid_path = dir.path().join("pid");
    let command = format!("echo $$ > {}; exec sleep 30", pid_path.display());
    let (updates, _rx) = mpsc::unbounded_channel();
    let handle = spawn_acp_session(
        "task".into(),
        command,
        dir.path().to_string_lossy().into_owned(),
        empty_prompt(),
        None,
        Vec::new(),
        updates,
        None,
        None,
        std::collections::HashMap::new(),
        super::super::accounts::AgentEnv::default(),
    )
    .unwrap();
    let pid = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(&pid_path) {
                break pid.trim().to_string();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("child should write pid");

    drop(handle);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let alive = Command::new("kill")
                .args(["-0", &pid])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .is_ok_and(|status| status.success());
            if !alive {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("dropping the handle should kill the child");
}
