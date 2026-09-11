// ─── Tests ───────────────────────────────────────────────────────────────────

use std::collections::HashMap;

use super::*;
use crate::workflow_config::{parse_workflow, WorkflowSpec};

fn spec(yaml: &str) -> WorkflowSpec {
    parse_workflow("test", yaml).0.expect("valid spec")
}

fn run_for(yaml: &str) -> WorkflowRun {
    WorkflowRun::new(
        "t_parent".into(),
        "demo".into(),
        spec(yaml),
        "claude".into(),
        Some("lead-model".into()),
        vec![],
        false,
        HashMap::new(),
    )
}

#[test]
fn stage_signal_detects_trailing_question() {
    let text = "I looked around.\n```json\n{\"need_user_input\": \"Which database?\"}\n```\n";
    assert_eq!(
        parse_stage_signal(text),
        StageSignal::Question("Which database?".into())
    );
    assert_eq!(
        parse_stage_signal("all done, no questions"),
        StageSignal::Output
    );
    // An empty question is not a question.
    assert_eq!(
        parse_stage_signal("```json\n{\"need_user_input\": \"  \"}\n```"),
        StageSignal::Output
    );
}

#[test]
fn verdict_parsing_happy_path_and_aliases() {
    let text = r#"Review done.
```json
{"verdict": "request_changes", "findings": [
  {"severity": "HIGH", "file": "src/a.rs", "description": "off-by-one"},
  {"severity": "nit", "description": "typo"},
  {"severity": "weird", "title": "fallback title"},
  {"description": ""}
]}
```"#;
    let (verdict, findings) = parse_review_verdict(text, "reviewer 1 (claude)").unwrap();
    assert_eq!(verdict, Verdict::RequestChanges);
    assert_eq!(findings.len(), 3, "empty description dropped");
    assert_eq!(findings[0].severity, Severity::High);
    assert_eq!(findings[0].file.as_deref(), Some("src/a.rs"));
    assert_eq!(findings[1].severity, Severity::Low);
    assert_eq!(findings[2].severity, Severity::Medium);
    assert_eq!(findings[2].description, "fallback title");
    assert!(findings.iter().all(|f| f.reviewer == "reviewer 1 (claude)"));
}

#[test]
fn verdict_parsing_uses_last_json_block_and_bare_fences() {
    let text = "```json\n{\"verdict\": \"approve\"}\n```\nwait, actually:\n```\n{\"verdict\": \"request_changes\", \"findings\": []}\n```";
    let (verdict, _) = parse_review_verdict(text, "r").unwrap();
    assert_eq!(verdict, Verdict::RequestChanges);
}

#[test]
fn verdict_parsing_errors() {
    assert!(parse_review_verdict("no block at all", "r")
        .unwrap_err()
        .contains("no fenced JSON"));
    // A JSON block without a `verdict` key is not the protocol payload.
    assert!(
        parse_review_verdict("```json\n{\"findings\": []}\n```", "r")
            .unwrap_err()
            .contains("no fenced JSON")
    );
    assert!(
        parse_review_verdict("```json\n{\"verdict\": \"maybe\"}\n```", "r")
            .unwrap_err()
            .contains("\"maybe\"")
    );
    // Non-JSON fenced blocks are skipped, not fatal.
    let text = "```rust\nfn x() {}\n```\n```json\n{\"verdict\": \"approve\"}\n```";
    assert!(parse_review_verdict(text, "r").is_ok());
}

#[test]
fn verdict_parsing_reads_finding_anchors() {
    let text = r#"```json
{"verdict": "request_changes", "findings": [
  {"severity": "high", "file": "src/a.rs", "line": 42, "snippet": "if attempts > max {", "description": "off-by-one"},
  {"severity": "high", "file": "src/b.rs", "line": "17-20", "code": "let x = 1;", "description": "string range"},
  {"severity": "low", "line": 0, "description": "no anchor"}
]}
```"#;
    let (_, findings) = parse_review_verdict(text, "r").unwrap();
    assert_eq!(findings[0].line, Some(42));
    assert_eq!(findings[0].snippet.as_deref(), Some("if attempts > max {"));
    // A range and a `code` alias both resolve.
    assert_eq!(findings[1].line, Some(17));
    assert_eq!(findings[1].snippet.as_deref(), Some("let x = 1;"));
    // Line 0 is not a location.
    assert_eq!(findings[2].line, None);
    assert_eq!(findings[2].snippet, None);

    // Anchors reach the repair prompt.
    let rendered = format_findings(&findings);
    assert!(rendered.contains("`src/a.rs:42`"), "{rendered}");
    assert!(rendered.contains("at: `if attempts > max {`"), "{rendered}");
    assert!(rendered.contains("`src/b.rs:17`"), "{rendered}");

    // An oversized excerpt is clipped to one line.
    let long = format!(
        "```json\n{{\"verdict\": \"approve\", \"findings\": [{{\"description\": \"d\", \"snippet\": \"{}\"}}]}}\n```",
        "x".repeat(400)
    );
    let (_, findings) = parse_review_verdict(&long, "r").unwrap();
    let snippet = findings[0].snippet.as_deref().unwrap();
    assert!(snippet.len() <= 204, "{}", snippet.len());
    assert!(snippet.ends_with('…'));
}

#[test]
fn protocol_payload_detection() {
    assert!(has_protocol_payload(
        "```json\n{\"verdict\": \"approve\"}\n```"
    ));
    assert!(has_protocol_payload(
        "```json\n{\"need_user_input\": \"which db?\"}\n```"
    ));
    // An unrelated JSON block is not a protocol payload — this is what
    // keeps a quoted config file from hijacking a stage's result.
    assert!(!has_protocol_payload("```json\n{\"name\": \"pkg\"}\n```"));
    assert!(!has_protocol_payload("just prose"));
}

#[test]
fn merge_reviews_requires_unanimous_approve() {
    let f = |desc: &str| Finding {
        severity: Severity::High,
        file: None,
        line: None,
        snippet: None,
        description: desc.into(),
        reviewer: "r".into(),
    };
    let (verdict, findings) = merge_reviews(&[
        (1, Verdict::Approve, vec![f("b")]),
        (0, Verdict::RequestChanges, vec![f("a")]),
    ]);
    assert_eq!(verdict, Verdict::RequestChanges);
    // Findings ordered by reviewer index.
    assert_eq!(findings[0].description, "a");
    assert_eq!(findings[1].description, "b");

    let (verdict, _) =
        merge_reviews(&[(0, Verdict::Approve, vec![]), (1, Verdict::Approve, vec![])]);
    assert_eq!(verdict, Verdict::Approve);
}

#[test]
fn stage_agent_fallback_chain() {
    let run = run_for(
        "name: X\nplan: {}\nimplement:\n  agent: codex\n  model: gpt-x\nreview:\n  reviewers:\n    - agent: opencode\n    - {}\n",
    );
    // plan has no override → lead agent + lead model.
    assert_eq!(
        run.stage_agent(StageKind::Plan, None),
        ("claude".into(), Some("lead-model".into()))
    );
    // implement overrides both.
    assert_eq!(
        run.stage_agent(StageKind::Implement, None),
        ("codex".into(), Some("gpt-x".into()))
    );
    // fix falls back to implement's overrides.
    assert_eq!(
        run.stage_agent(StageKind::Fix, None),
        ("codex".into(), Some("gpt-x".into()))
    );
    // reviewer 0 overrides agent, inherits lead model; reviewer 1 → lead.
    assert_eq!(
        run.stage_agent(StageKind::Review, Some(0)),
        ("opencode".into(), Some("lead-model".into()))
    );
    assert_eq!(
        run.stage_agent(StageKind::Review, Some(1)),
        ("claude".into(), Some("lead-model".into()))
    );
}

#[test]
fn first_stage_respects_plan_presence() {
    assert_eq!(run_for("name: X\n").first_stage(), StageKind::Implement);
    assert_eq!(
        run_for("name: X\nplan: {}\n").first_stage(),
        StageKind::Plan
    );
}

#[test]
fn default_prompts_include_context_and_protocols() {
    let run = run_for("name: X\nplan: {}\nreview:\n  reviewers:\n    - focus: security only\n");
    let ctx = PromptCtx {
        task_prompt: "Add rate limiting".into(),
        plan: Some("1. do things".into()),
        implementer_summary: Some("did things".into()),
        diff: Some("--- a/x\n+++ b/x".into()),
        findings: Some("1. [high] — bug (r)".into()),
        prior_findings: None,
        round: 1,
        max_rounds: 2,
        guidance: Some("prefer tower middleware".into()),
    };

    let plan = build_plan_prompt(&run.spec, &ctx);
    assert!(plan.contains("Add rate limiting"));
    assert!(plan.contains("need_user_input"));
    assert!(plan.contains("User guidance"));

    let implement = build_implement_prompt(&run.spec, &ctx);
    assert!(implement.contains("Approved plan"));
    assert!(implement.contains("1. do things"));

    let review = build_reviewer_prompt(&run.spec, 0, &ctx);
    assert!(review.contains("security only"));
    assert!(review.contains("Working-copy diff"));
    assert!(review.contains("\"verdict\""));
    assert!(
        !review.contains("User guidance"),
        "guidance must not leak to reviewers"
    );

    let fix = build_fix_prompt(&run.spec, &ctx);
    assert!(fix.contains("Findings to address"));
    assert!(fix.contains("round 1/2"));
}

#[test]
fn custom_prompts_render_placeholders_and_keep_protocol() {
    let run = run_for(
        "name: X\nimplement:\n  prompt: \"Do {{task_prompt}} now\"\nreview:\n  reviewers:\n    - prompt: \"{{focus}} check {{diff}} r{{round}}\"\n      focus: perf\n",
    );
    let ctx = PromptCtx {
        task_prompt: "the thing".into(),
        diff: Some("DIFF".into()),
        round: 2,
        max_rounds: 3,
        ..Default::default()
    };
    let implement = build_implement_prompt(&run.spec, &ctx);
    assert!(implement.starts_with("Do the thing now"));
    assert!(
        implement.contains("need_user_input"),
        "protocol always appended"
    );

    let review = build_reviewer_prompt(&run.spec, 0, &ctx);
    assert!(review.starts_with("perf check DIFF r2"));
    assert!(review.contains("\"verdict\""));
}

#[test]
fn repeat_round_reviewer_prompt_verifies_prior_findings() {
    let run = run_for("name: X\nreview:\n  reviewers:\n    - focus: security\n");
    let base = PromptCtx {
        task_prompt: "Add rate limiting".into(),
        diff: Some("DIFF".into()),
        round: 2,
        max_rounds: 3,
        ..Default::default()
    };
    // Round 1 (no prior findings): no verification section.
    let first = build_reviewer_prompt(&run.spec, 0, &base);
    assert!(!first.contains("Previous round's findings"));

    let ctx = PromptCtx {
        prior_findings: Some("1. [high] `a.rs` — bug here (reviewer)".into()),
        ..base.clone()
    };
    let repeat = build_reviewer_prompt(&run.spec, 0, &ctx);
    assert!(repeat.contains("Previous round's findings — verify each one"));
    assert!(repeat.contains("bug here"));
    assert!(repeat.contains("regressions"));

    // The verification section is engine-owned: custom reviewer prompts
    // get it appended too, without any template changes.
    let custom = run_for("name: X\nreview:\n  reviewers:\n    - prompt: \"check {{diff}}\"\n");
    let repeat = build_reviewer_prompt(&custom.spec, 0, &ctx);
    assert!(repeat.starts_with("check DIFF"));
    assert!(repeat.contains("Previous round's findings — verify each one"));
    assert!(
        repeat.contains("\"verdict\""),
        "protocol still appended last"
    );
}

#[test]
fn rereview_followup_carries_delta_and_instructions() {
    let ctx = PromptCtx {
        task_prompt: "irrelevant — the session already has it".into(),
        implementer_summary: Some("FIX-DONE: patched the parser".into()),
        prior_findings: Some("1. [high] — off-by-one (reviewer)".into()),
        diff: Some("THE-NEW-DIFF".into()),
        round: 2,
        max_rounds: 2,
        ..Default::default()
    };
    let followup = build_rereview_prompt(&ctx);
    assert!(followup.starts_with("The repair stage has addressed your review"));
    assert!(followup.contains("round 2/2"));
    assert!(followup.contains("FIX-DONE: patched the parser"));
    assert!(followup.contains("off-by-one"));
    assert!(followup.contains("THE-NEW-DIFF"));
    assert!(followup.contains("regressions"));
    assert!(
        followup.contains("\"verdict\""),
        "verdict protocol reminder"
    );
    // The session already has the task prompt — the follow-up must not
    // re-send it.
    assert!(!followup.contains("irrelevant — the session already has it"));
}

#[test]
fn all_children_spans_history_and_active() {
    let mut run = run_for("name: X\n");
    run.record_stage(StageKind::Implement, "t_impl", "claude", "implement".into());
    run.record_stage(StageKind::Review, "t_rev", "claude", "reviewer".into());
    run.active_children.insert("t_fix".into(), StageKind::Fix);
    let all = run.all_children();
    assert_eq!(all.len(), 3);
    for id in ["t_impl", "t_rev", "t_fix"] {
        assert!(all.contains(id), "{id} missing");
    }
}

#[test]
fn diff_formatting_and_truncation() {
    let hunk = wire::Hunk {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: vec!["-old".into(), "+new".into()],
        resolution: None,
    };
    let small = vec![wire::FileDiff {
        path: "src/a.rs".into(),
        old_path: None,
        status: wire::FileDiffStatus::Modified,
        hunks: vec![hunk.clone()],
    }];
    let text = format_diff(&small);
    assert!(text.contains("--- a/src/a.rs"));
    assert!(text.contains("+new"));

    let big_hunk = wire::Hunk {
        lines: vec!["+x".to_string(); 300_000],
        ..hunk
    };
    let big = vec![
        wire::FileDiff {
            path: "src/big.rs".into(),
            old_path: None,
            status: wire::FileDiffStatus::Modified,
            hunks: vec![big_hunk],
        },
        wire::FileDiff {
            path: "src/other.rs".into(),
            old_path: None,
            status: wire::FileDiffStatus::Added,
            hunks: vec![],
        },
    ];
    let text = format_diff(&big);
    assert!(text.len() < DIFF_CONTEXT_MAX_BYTES + 1024);
    assert!(text.contains("[diff truncated"));
    assert!(
        text.contains("- src/other.rs"),
        "file list survives truncation"
    );

    assert_eq!(format_diff(&[]), "(no changes in the working copy)");
}

#[test]
fn summary_clip_keeps_tail() {
    let long = format!("{}THE-END", "x".repeat(SUMMARY_CONTEXT_MAX_BYTES * 2));
    let clipped = clip_summary(&long);
    assert!(clipped.len() <= SUMMARY_CONTEXT_MAX_BYTES + 32);
    assert!(clipped.ends_with("THE-END"));
    assert!(clipped.starts_with("[…truncated…]"));
    assert_eq!(clip_summary("short"), "short");
}

#[test]
fn wire_info_reflects_state() {
    let mut run = run_for("name: My flow\nreview:\n  max_rounds: 2\n");
    run.state = RunState::Running {
        stage: StageKind::Implement,
    };
    let info = run.wire_info();
    assert_eq!(info.stage, wire::WorkflowStage::Implement);
    assert!(info.waiting.is_none());
    assert!(!info.pause_requested);
    assert_eq!(info.max_rounds, 2);

    // A requested pause is visible before it takes effect, so the UI can
    // show progress rather than an idle Pause button.
    run.pause_requested = true;
    assert!(run.wire_info().pause_requested);
    run.pause_requested = false;

    run.extra_rounds = 2;
    run.state = RunState::AwaitingReply {
        stage: StageKind::Plan,
        child: "t_c".into(),
        question: "which db?".into(),
    };
    let info = run.wire_info();
    assert_eq!(info.max_rounds, 4);
    let waiting = info.waiting.unwrap();
    assert_eq!(waiting.kind, wire::WorkflowWaitKind::Question);
    assert_eq!(waiting.question.as_deref(), Some("which db?"));

    run.open_findings = vec![Finding {
        severity: Severity::High,
        file: None,
        line: None,
        snippet: None,
        description: "d".into(),
        reviewer: "r".into(),
    }];
    run.state = RunState::AwaitingLimitDecision;
    let waiting = run.wire_info().waiting.unwrap();
    assert_eq!(waiting.kind, wire::WorkflowWaitKind::Limit);
    assert_eq!(waiting.question.as_deref(), Some("open findings: 1 high"));

    run.state = RunState::Paused {
        next: StageKind::Fix,
    };
    let info = run.wire_info();
    assert_eq!(info.stage, wire::WorkflowStage::Fix);
    assert_eq!(info.waiting.unwrap().kind, wire::WorkflowWaitKind::Paused);
}

#[test]
fn graph_info_maps_history() {
    let mut run = run_for("name: X\n");
    run.record_stage(StageKind::Implement, "t_1", "claude", "implement".into());
    run.set_record_status("t_1", wire::OrchNodeStatus::Complete);
    run.record_stage(
        StageKind::Review,
        "t_2",
        "codex",
        "reviewer 1/2 (codex)".into(),
    );
    let graph = run.graph_info();
    assert_eq!(graph.goal, "X");
    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.nodes[0].status, wire::OrchNodeStatus::Complete);
    assert_eq!(graph.nodes[0].kind, wire::OrchNodeKind::Implement);
    assert_eq!(graph.nodes[1].task_id.as_deref(), Some("t_2"));
    assert_eq!(graph.nodes[1].kind, wire::OrchNodeKind::Review);
}

#[test]
fn run_serialization_roundtrip() {
    let mut run = run_for("name: X\nplan: {}\n");
    run.state = RunState::Paused {
        next: StageKind::Review,
    };
    run.round = 2;
    run.open_findings = vec![Finding {
        severity: Severity::Critical,
        file: Some("a.rs".into()),
        line: Some(7),
        snippet: Some("let x = 1;".into()),
        description: "boom".into(),
        reviewer: "r".into(),
    }];
    let json = serde_json::to_string(&run).unwrap();
    let restored: WorkflowRun = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.state, run.state);
    assert_eq!(restored.round, 2);
    assert_eq!(restored.spec, run.spec);
    assert_eq!(restored.open_findings, run.open_findings);
}
