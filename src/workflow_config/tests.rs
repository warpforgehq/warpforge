use super::*;
use std::collections::HashMap;
use std::fs;

// ─── Tests ───────────────────────────────────────────────────────────────────

fn parse_ok(yaml: &str) -> (WorkflowSpec, Vec<String>) {
    let (spec, warnings) = parse_workflow("test", yaml);
    (spec.expect("expected valid workflow"), warnings)
}

fn parse_err(yaml: &str) -> String {
    let (spec, _) = parse_workflow("test", yaml);
    spec.expect_err("expected invalid workflow")
}

#[test]
fn minimal_workflow_gets_defaults() {
    let (spec, warnings) = parse_ok("name: Minimal\n");
    assert!(warnings.is_empty());
    assert_eq!(spec.name, "Minimal");
    assert!(spec.plan.is_none());
    assert_eq!(spec.implement, StageConfig::default());
    assert_eq!(spec.review.max_rounds, DEFAULT_MAX_ROUNDS);
    assert_eq!(spec.review.on_limit, OnLimit::Ask);
    assert_eq!(spec.review.reask, ReaskMode::SameSession);
    assert_eq!(spec.review.reviewers, vec![ReviewerConfig::default()]);
    assert_eq!(
        spec.review.context,
        vec![
            ReviewContextItem::Prompt,
            ReviewContextItem::Plan,
            ReviewContextItem::ImplementerSummary,
            ReviewContextItem::Diff,
        ]
    );
    assert_eq!(spec.stage_summary(), vec!["implement", "review", "fix"]);
}

#[test]
fn builtins_are_valid() {
    for (id, text) in BUILTIN_WORKFLOWS {
        let (spec, warnings) = parse_workflow(id, text);
        let spec = spec.unwrap_or_else(|e| panic!("built-in `{id}` invalid: {e}"));
        assert!(
            warnings.is_empty(),
            "built-in `{id}` has warnings: {warnings:?}"
        );
        assert_eq!(spec.id, *id);
    }
}

#[test]
fn bare_plan_key_enables_stage() {
    assert!(parse_ok("name: X\n").0.plan.is_none());
    assert_eq!(
        parse_ok("name: X\nplan:\n").0.plan,
        Some(StageConfig::default())
    );
    assert_eq!(
        parse_ok("name: X\nplan: {}\n").0.plan,
        Some(StageConfig::default())
    );
    let (spec, _) = parse_ok("name: X\nplan:\n  agent: codex\n");
    assert_eq!(spec.plan.unwrap().agent.as_deref(), Some("codex"));
}

#[test]
fn full_workflow_parses() {
    let yaml = r#"
version: 1
name: Feature loop
description: Cross-review with two models.
plan:
  agent: claude
implement:
  agent: claude
  model: claude-fable-5
review:
  max_rounds: 3
  on_limit: finish
  reask: fresh
  context: [prompt, diff]
  reviewers:
    - agent: claude
      model: claude-opus-5
      focus: correctness
    - agent: codex
      prompt: "Review this: {{diff}} for round {{round}}/{{max_rounds}}"
fix:
  agent: claude
"#;
    let (spec, warnings) = parse_ok(yaml);
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(spec.review.max_rounds, 3);
    assert_eq!(spec.review.on_limit, OnLimit::Finish);
    assert_eq!(spec.review.reask, ReaskMode::Fresh);
    assert_eq!(
        spec.review.context,
        vec![ReviewContextItem::Prompt, ReviewContextItem::Diff]
    );
    assert_eq!(spec.review.reviewers.len(), 2);
    assert_eq!(spec.review.reviewers[1].agent.as_deref(), Some("codex"));
    assert_eq!(
        spec.stage_summary(),
        vec!["plan", "implement", "review×2", "fix"]
    );
}

#[test]
fn unknown_keys_warn_but_stay_valid() {
    let yaml = "name: X\nfuture_thing: 1\nreview:\n  gate: build\n  reviewers:\n    - agent: claude\n      voice: loud\n";
    let (spec, warnings) = parse_workflow("test", yaml);
    assert!(spec.is_ok());
    assert_eq!(
        warnings,
        vec![
            "unknown key `future_thing` in top level",
            "unknown key `gate` in review",
            "unknown key `voice` in review.reviewers[0]",
        ]
    );
}

#[test]
fn validation_errors() {
    assert!(parse_err("services: {}\n").contains("`name` is required"));
    assert!(parse_err("name: X\nversion: 2\n").contains("unsupported workflow version 2"));
    assert!(parse_err("name: X\nreview:\n  max_rounds: 0\n").contains("at least 1"));
    assert!(parse_err("name: X\nreview:\n  on_limit: retry\n").contains("`ask` or `finish`"));
    assert!(parse_err("name: X\nreview:\n  reask: never\n").contains("`same_session` or `fresh`"));
    assert!(
        parse_err("name: X\nreview:\n  context: [prompt, everything]\n")
            .contains("unknown review.context item `everything`")
    );
    assert!(parse_err("name: X\nreview:\n  reviewers: []\n").contains("1..4 reviewers"));
    let five = "name: X\nreview:\n  reviewers:\n    - {}\n    - {}\n    - {}\n    - {}\n    - {}\n";
    assert!(parse_err(five).contains("1..4 reviewers"));
    assert!(parse_workflow("test", ": : :")
        .0
        .unwrap_err()
        .contains("invalid YAML"));
}

#[test]
fn max_rounds_clamped_with_warning() {
    let (spec, warnings) = parse_ok("name: X\nreview:\n  max_rounds: 9\n");
    assert_eq!(spec.review.max_rounds, MAX_ROUNDS_CAP);
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("clamped to 5"));
}

#[test]
fn unknown_placeholder_is_an_error() {
    let err = parse_err("name: X\nimplement:\n  prompt: \"Do {{taks_prompt}}\"\n");
    assert!(
        err.contains("unknown placeholder {{taks_prompt}} in implement prompt"),
        "{err}"
    );
    // `{{diff}}` is a review/fix variable, not an implement one.
    let err = parse_err("name: X\nimplement:\n  prompt: \"See {{diff}}\"\n");
    assert!(err.contains("{{diff}}"), "{err}");
    // Reviewer prompts may use the review variable set, including {{focus}}.
    let yaml = "name: X\nreview:\n  reviewers:\n    - prompt: \"{{focus}}: check {{diff}}\"\n";
    assert!(parse_workflow("test", yaml).0.is_ok());
    // {{plan}} is rejected when the workflow has no planning stage — it
    // would render an empty section instead of a plan.
    let err = parse_err("name: X\nimplement:\n  prompt: \"Plan: {{plan}}\"\n");
    assert!(err.contains("{{plan}}"), "{err}");
    assert!(parse_workflow(
        "test",
        "name: X\nplan: {}\nimplement:\n  prompt: \"Plan: {{plan}}\"\n"
    )
    .0
    .is_ok());
}

#[test]
fn inert_reviewer_knobs_warn() {
    // `context` and `focus` only shape the built-in reviewer prompt, so
    // setting them next to a custom prompt must not pass silently.
    let (spec, warnings) = parse_workflow(
        "test",
        "name: X\nreview:\n  context: [prompt]\n  reviewers:\n    - focus: security\n      prompt: \"check it\"\n",
    );
    assert!(spec.is_ok());
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("review.context is ignored")),
        "{warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("focus is ignored") && w.contains("{{focus}}")),
        "{warnings:?}"
    );
    // A custom prompt that actually uses {{focus}} draws no warning.
    let (_, warnings) = parse_workflow(
        "test",
        "name: X\nreview:\n  reviewers:\n    - focus: security\n      prompt: \"{{focus}}\"\n",
    );
    assert!(warnings.is_empty(), "{warnings:?}");
}

#[test]
fn plan_false_disables_the_stage() {
    assert!(parse_ok("name: X\nplan: false\n").0.plan.is_none());
    assert!(parse_ok("name: X\nplan: true\n").0.plan.is_some());
}

#[test]
fn placeholder_extraction_and_rendering() {
    assert_eq!(
        extract_placeholders("{{a}} and {{ b }} and {{a}} but not {{a b}} or {{}}"),
        vec!["a", "b"]
    );
    let vars = HashMap::from([
        ("task_prompt", "fix the bug".to_string()),
        ("round", "2".to_string()),
    ]);
    assert_eq!(
        render_template(
            "Task: {{task_prompt}} (round {{ round }}) {{unknown}}",
            &vars
        ),
        "Task: fix the bug (round 2) {{unknown}}"
    );
    assert_eq!(render_template("no placeholders", &vars), "no placeholders");
}

#[test]
fn listing_project_overrides_builtin_and_reports_invalid() {
    let dir = tempfile::tempdir().unwrap();
    let wf_dir = workflows_dir(dir.path());
    fs::create_dir_all(&wf_dir).unwrap();
    // Overrides the built-in of the same id.
    fs::write(wf_dir.join("review-loop.yaml"), "name: Mine\n").unwrap();
    // Invalid file still listed.
    fs::write(wf_dir.join("broken.yaml"), "name: [\n").unwrap();
    // Non-workflow files ignored.
    fs::write(wf_dir.join("notes.txt"), "hi").unwrap();

    let listed = list_workflows(dir.path());
    let ids: Vec<(&str, WorkflowSource, bool)> = listed
        .iter()
        .map(|w| (w.id.as_str(), w.source, w.spec.is_ok()))
        .collect();
    assert_eq!(
        ids,
        vec![
            ("broken", WorkflowSource::Project, false),
            ("review-loop", WorkflowSource::Project, true),
            ("plan-review-loop", WorkflowSource::Builtin, true),
        ]
    );
    let mine = load_workflow(dir.path(), "review-loop").unwrap();
    assert_eq!(mine.spec.unwrap().name, "Mine");
}

#[test]
fn listing_without_workflows_dir_returns_builtins() {
    let dir = tempfile::tempdir().unwrap();
    let listed = list_workflows(dir.path());
    assert_eq!(listed.len(), BUILTIN_WORKFLOWS.len());
    assert!(listed.iter().all(|w| w.source == WorkflowSource::Builtin));
}

#[test]
fn duplicate_stems_warn_and_first_wins() {
    let dir = tempfile::tempdir().unwrap();
    let wf_dir = workflows_dir(dir.path());
    fs::create_dir_all(&wf_dir).unwrap();
    fs::write(wf_dir.join("loop.yaml"), "name: From yaml\n").unwrap();
    fs::write(wf_dir.join("loop.yml"), "name: From yml\n").unwrap();

    let listed = list_workflows(dir.path());
    let entry = listed.iter().find(|w| w.id == "loop").unwrap();
    assert_eq!(entry.spec.as_ref().unwrap().name, "From yaml");
    assert_eq!(
        entry.warnings,
        vec!["duplicate workflow file ignored: loop.yml"]
    );
}

#[test]
fn eject_writes_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = eject_builtin(dir.path(), "review-loop").unwrap();
    assert!(path.ends_with(".warpforge/workflows/review-loop.yaml"));
    let text = fs::read_to_string(&path).unwrap();
    assert!(parse_workflow("review-loop", &text).0.is_ok());
    // Second eject refuses to overwrite.
    assert!(eject_builtin(dir.path(), "review-loop").is_err());
    assert!(eject_builtin(dir.path(), "nope").is_err());
}
