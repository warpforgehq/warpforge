use super::*;
use crate::mcp::agents::{
    model_ids, render_agents_listing, validate_model, DEFAULT_CLEANUP_MAX_AGE_SECONDS,
};
use crate::mcp::format::{scoped_project, tool_limit};
use crate::mcp::logs::{fmt_utc, render_log_selection};

#[test]
fn cwd_resolves_to_the_deepest_registered_project() {
    let roots = vec![
        ("outer".to_string(), PathBuf::from("/w/outer")),
        (
            "inner".to_string(),
            PathBuf::from("/w/outer/packages/inner"),
        ),
        ("sibling".to_string(), PathBuf::from("/w/outer-sibling")),
    ];

    let pick = |cwd: &str| pick_project(&roots, Path::new(cwd));
    assert_eq!(pick("/w/outer/src").as_deref(), Some("outer"));
    assert_eq!(
        pick("/w/outer/packages/inner/src").as_deref(),
        Some("inner")
    );
    // A task worktree lives under its project root.
    assert_eq!(pick("/w/outer/.worktrees/t_1").as_deref(), Some("outer"));
    // A sibling sharing a name prefix is not a parent directory.
    assert_eq!(pick("/w/outer-sibling/src").as_deref(), Some("sibling"));
    assert_eq!(pick("/tmp/unregistered"), None);
}

#[test]
fn lifecycle_tools_advertise_stop_and_destructive_cleanup() {
    let tools = tool_defs(true);
    let definitions = tools.as_array().expect("tool definitions");
    let names: Vec<&str> = definitions
        .iter()
        .filter_map(|definition| definition.get("name").and_then(Value::as_str))
        .collect();

    assert!(names.contains(&"stop_agent"));
    assert!(names.contains(&"cleanup_agents"));
    assert!(!names.contains(&"kill_agent"));
    assert!(names.contains(&"create_backlog_task"));
    assert!(names.contains(&"create_task"));
    let legacy = definitions
        .iter()
        .find(|definition| definition["name"] == "create_task")
        .expect("deprecated create_task alias");
    assert_eq!(legacy["deprecated"], true);
    assert_eq!(DEFAULT_CLEANUP_MAX_AGE_SECONDS, 0);

    let cleanup = definitions
        .iter()
        .find(|definition| definition["name"] == "cleanup_agents")
        .expect("cleanup tool definition");
    let description = cleanup["description"].as_str().unwrap_or_default();
    assert!(description.contains("Permanently remove"));
    assert!(description.contains("task record and session history are deleted"));
}

#[test]
fn single_mode_hides_orchestrator_tools_but_ships_core_tools() {
    let core = tool_defs(false)
        .as_array()
        .expect("tool definitions")
        .clone();
    let core_names: Vec<&str> = core
        .iter()
        .filter_map(|t| t.get("name").and_then(Value::as_str))
        .collect();
    for tool in [
        "list_runtime",
        "read_service_logs",
        "read_portforward_logs",
        "service_start",
        "service_stop",
        "service_restart",
        "portforward_start",
        "portforward_stop",
        "create_backlog_task",
        "create_task",
    ] {
        assert!(
            core_names.contains(&tool),
            "single mode must advertise {tool}"
        );
    }

    let backlog = core
        .iter()
        .find(|tool| tool["name"] == "create_backlog_task")
        .expect("backlog tool definition");
    assert_eq!(backlog["deprecated"], Value::Null);
    let legacy = core
        .iter()
        .find(|tool| tool["name"] == "create_task")
        .expect("deprecated create_task alias");
    assert_eq!(legacy["deprecated"], true);
    assert!(legacy["description"]
        .as_str()
        .unwrap_or_default()
        .contains("create_backlog_task"));
    for tool in [
        "spawn_agent",
        "read_inbox",
        "spawn_workflow",
        "decide_workflow",
    ] {
        assert!(
            !core_names.contains(&tool),
            "single mode must NOT advertise {tool}"
        );
    }
}

#[test]
fn project_scope_cannot_escape_the_orchestrator_project() {
    assert_eq!(
        scoped_project(&json!({}), "demo").unwrap(),
        Some("demo".to_string())
    );
    assert!(scoped_project(&json!({ "project": "other" }), "demo").is_err());
}

#[test]
fn unbound_session_cannot_target_a_project_by_argument() {
    // No bound project scope: requesting a project by argument must fail,
    // so a project-less session cannot reach another project's runtime.
    assert_eq!(scoped_project(&json!({}), "").unwrap(), None);
    assert!(scoped_project(&json!({ "project": "other" }), "").is_err());
}

#[test]
fn tool_limit_defaults_to_100_and_clamps_to_u32() {
    assert_eq!(tool_limit(&json!({})), 100);
    assert_eq!(tool_limit(&json!({ "limit": 5 })), 5);
    assert_eq!(tool_limit(&json!({ "limit": 5_000_000_000u64 })), u32::MAX);
}

/// Filter runs over the WHOLE buffer, then the newest `limit` are kept
/// (grep | tail) — not the first `limit`, and not a window-then-filter.
#[test]
fn filter_then_tail_keeps_newest_matches_across_the_whole_buffer() {
    let mut lines: Vec<String> = (0..50).map(|i| format!("line {i}")).collect();
    lines[0] = "ERROR early".into();
    lines[1] = "ERROR early2".into();
    lines[42] = "ERROR late".into();
    lines[43] = "ERROR late2".into();
    let at: Vec<u64> = lines.iter().map(|_| 0).collect();
    let body = render_log_selection(&lines, &at, Some("ERROR"), 0, 3, false);
    assert_eq!(body, "ERROR early2\nERROR late\nERROR late2");
}

#[test]
fn context_expands_around_each_match_and_overlapping_spans_merge() {
    let mut lines: Vec<String> = (0..20).map(|i| format!("line {i}")).collect();
    lines[5] = "ERR at 5".into();
    lines[7] = "ERR at 7".into();
    let at: Vec<u64> = lines.iter().map(|_| 0).collect();
    // matches at 5 and 7, context 2 -> spans [3,8) and [5,10) merge to [3,10)
    let body = render_log_selection(&lines, &at, Some("ERR"), 2, 100, false);
    assert_eq!(
        body,
        "line 3\nline 4\nERR at 5\nline 6\nERR at 7\nline 8\nline 9"
    );
}

#[test]
fn no_match_returns_empty_and_timestamps_prepend_utc() {
    let lines = vec!["a".to_string(), "b".to_string()];
    let at = vec![0u64, 1_700_000_000_000u64];
    assert_eq!(
        render_log_selection(&lines, &at, Some("zzz"), 0, 100, true),
        ""
    );
    let body = render_log_selection(&lines, &at, Some("b"), 0, 100, true);
    assert!(body.starts_with("[2023-11-14 "), "got: {body}");
    assert!(body.ends_with("] b"), "got: {body}");
    // timestamps=false returns the raw line
    assert_eq!(
        render_log_selection(&lines, &at, Some("b"), 0, 100, false),
        "b"
    );
}

#[test]
fn fmt_utc_renders_epoch() {
    assert_eq!(fmt_utc(0), "1970-01-01 00:00:00Z");
    assert_eq!(fmt_utc(86_400_000), "1970-01-02 00:00:00Z");
}

#[test]
fn model_ids_extract_and_validate() {
    let models = json!([
        {"id":"model","name":"Model","category":"model","current_value":"a","options":[{"value":"gpt-4","name":"GPT-4"},{"value":"codex-mini","name":"Mini"}]},
        {"id":"mode","name":"Mode","category":"mode","current_value":"x","options":[{"value":"plan","name":"Plan"}]}
    ]);
    let arr = models.as_array().unwrap().clone();
    let ids = model_ids(&arr);
    assert_eq!(ids, vec!["gpt-4", "codex-mini"]);
    assert!(validate_model(&arr, "gpt-4", "claude").is_ok());
    let err = validate_model(&arr, "latest", "claude")
        .unwrap_err()
        .to_string();
    assert!(err.contains("valid ids: [gpt-4, codex-mini]"), "got: {err}");
    assert!(!ids.contains(&"plan".to_string()));
    assert!(validate_model(&[], "anything", "claude").is_ok());
    // model_config toggle must NOT leak into ids (DEFECT 1)
    let with_toggle = json!([
        {"id":"model","name":"Model","category":"model","current_value":"a","options":[{"value":"sonnet","name":"Sonnet"},{"value":"haiku","name":"Haiku"}]},
        {"id":"fast","name":"Fast mode","category":"model_config","current_value":"off","options":[{"value":"on","name":"On"},{"value":"off","name":"Off"}]}
    ]);
    let arr2 = with_toggle.as_array().unwrap().clone();
    let ids2 = model_ids(&arr2);
    assert_eq!(ids2, vec!["sonnet", "haiku"]);
    assert!(validate_model(&arr2, "on", "claude").is_err());
    assert!(validate_model(&arr2, "sonnet", "claude").is_ok());
}

#[test]
fn agents_listing_projection_is_compact_and_keeps_decision_critical_fields() {
    let fat_model_selector: Vec<Value> = (0..368)
        .map(|i| json!({"value": format!("vendor/model-{}", i), "name": format!("Model {i}")}))
        .collect();
    let agents = json!([
        {
            "id": "t_1",
            "agent": "opencode",
            "status": "running",
            "prompt": "Fix the auth middleware so expired refresh tokens are rejected\n\nAnd here are several more kilobytes of detail\nthat must never appear in the output.",
            "title": "Fix auth middleware refresh handling",
            "createdAt": 1_756_000_000u64,
            "updatedAt": 1_756_369_500u64,
            "filesChanged": 3,
            "configOptions": [{"id":"model","category":"model","options": fat_model_selector}],
            "tags": ["orchestrator", "subagent"],
        },
        {
            "id": "t_2",
            "agent": "claude",
            "status": "running",
            "prompt": "Implement the multi-stage pipeline goal",
            "updatedAt": 1_756_369_500u64,
            "workflowRun": {
                "workflowId": "dev-flow",
                "stage": "review",
                "round": 2,
                "maxRounds": 3,
                "waiting": {
                    "kind": "question",
                    "stage": "review",
                    "question": "Should the fix stage also update the changelog?"
                }
            },
            "orchestrationGraph": {
                "id": "g",
                "goal": "goal text",
                "nodes": [
                    {"id":"n1","kind":"plan","agent":"claude","status":"complete"},
                    {"id":"n2","kind":"implement","agent":"claude","status":"complete"},
                    {"id":"n3","kind":"review","agent":"codex","status":"running"}
                ]
            }
        }
    ]);
    let out = render_agents_listing(agents.as_array().unwrap());

    // Compact: no model ids from the fat configOptions leak through.
    assert!(!out.contains("vendor/model-"), "got: {out}");
    assert!(!out.contains("configOptions"));
    // Prompt is truncated to a short label — full multi-line prompt never leaks.
    assert!(!out.contains("kilobytes"), "got: {out}");
    assert_eq!(
        out.lines()
            .find(|l| l.starts_with("t_1"))
            .expect("t_1 line"),
        "t_1 | opencode | running | 2025-08-28 08:25:00Z | Fix auth middleware refresh handling | files=3"
    );
    // Workflow stage/round/waiting survive the projection.
    let t2 = out.lines().find(|l| l.starts_with("t_2")).unwrap();
    assert!(t2.contains("wf stage=review"), "got: {t2}");
    assert!(t2.contains("round=2/3"), "got: {t2}");
    assert!(t2.contains("waiting=question"), "got: {t2}");
    assert!(t2.contains("changelog"), "got: {t2}");
    // Graph reduced to one compact status line.
    assert!(
        t2.contains("graph: plan:complete implement:complete review:running"),
        "got: {t2}"
    );
    // Output stays tiny per task (well under any tool-result limit).
    for line in out.lines() {
        assert!(line.len() < 500, "line too long: {line}");
    }
}

#[test]
fn agents_listing_handles_blocked_and_truncates_long_prompts() {
    let agents = json!([
        {
            "id": "t_3",
            "agent": "codex",
            "status": "blocked",
            "prompt": "x".repeat(300),
            "blockedKind": "session_lost",
            "blockedReason": "the saved native session no longer exists and cannot be resumed",
            "updatedAt": 1_756_369_500u64,
            "filesChanged": 0,
        }
    ]);
    let out = render_agents_listing(agents.as_array().unwrap());
    let line = out.lines().find(|l| l.starts_with("t_3")).unwrap();
    // No title set -> truncated first (only) line of the prompt, hard-capped.
    assert!(line.contains(&"x".repeat(80)), "got: {line}");
    assert!(!line.contains(&"x".repeat(81)), "got: {line}");
    // blockedKind/reason kept; zero filesChanged omitted.
    assert!(line.contains("session_lost:"), "got: {line}");
    assert!(line.contains("no longer exists"), "got: {line}");
    assert!(!line.contains("files="), "got: {line}");
    assert!(render_agents_listing(&[]).contains("No sub-agent sessions"));
}
