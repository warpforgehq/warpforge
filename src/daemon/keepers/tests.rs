use warpforge_protocol as wire;
use wire::KeeperFindingStatus as Status;

use super::presets::{PREAMBLE, PRESETS};
use super::*;

fn parse(yaml: &str) -> (Result<wire::KeeperDefinition, String>, Vec<String>) {
    parse_keeper("k", yaml)
}

fn valid(yaml: &str) -> wire::KeeperDefinition {
    let (definition, warnings) = parse(yaml);
    assert!(warnings.is_empty(), "{warnings:?}");
    definition.unwrap()
}

fn error(yaml: &str) -> String {
    parse(yaml).0.unwrap_err()
}

#[test]
fn a_full_file_parses_every_field() {
    let definition = valid(
        r#"
version: 1
name: Security
description: Exploitable paths.
when: ready
result: pass_fail
agent: codex
model: gpt-5
effort: high
time_limit: 20m
max_rounds: 2
min_severity: high
default: off
paths: ["src/**", "!**/*.md"]
prompt: |
  Report vulnerabilities in {{diff}}.
"#,
    );
    assert_eq!(definition.id, "k");
    assert_eq!(definition.name, "Security");
    assert_eq!(
        definition.description.as_deref(),
        Some("Exploitable paths.")
    );
    assert_eq!(definition.preset, None);
    assert_eq!(definition.when, wire::KeeperWhen::Ready);
    assert_eq!(definition.result, wire::KeeperResultKind::PassFail);
    assert_eq!(definition.agent.as_deref(), Some("codex"));
    assert_eq!(definition.model.as_deref(), Some("gpt-5"));
    assert_eq!(definition.effort.as_deref(), Some("high"));
    assert_eq!(definition.time_limit_secs, 20 * 60);
    assert_eq!(definition.max_rounds, 2);
    assert_eq!(definition.min_severity, wire::KeeperSeverity::High);
    assert!(!definition.default_on);
    assert_eq!(definition.paths, vec!["src/**", "!**/*.md"]);
    assert!(definition.prompt.starts_with(PREAMBLE.trim_end()));
    assert!(definition
        .prompt
        .ends_with("Report vulnerabilities in {{diff}}.\n"));
}

#[test]
fn omitted_values_take_the_adr_defaults() {
    let definition = valid("name: Mine\ninstructions: Look for typos.");
    assert_eq!(definition.when, wire::KeeperWhen::Commit);
    assert_eq!(definition.result, wire::KeeperResultKind::Findings);
    assert_eq!(definition.time_limit_secs, DEFAULT_TIME_LIMIT_SECS);
    assert_eq!(definition.max_rounds, DEFAULT_MAX_ROUNDS);
    assert_eq!(definition.min_severity, wire::KeeperSeverity::Medium);
    assert!(definition.default_on);
    assert!(definition.paths.is_empty());
    assert!(definition.prompt.ends_with("Look for typos.\n"));
}

#[test]
fn unknown_keys_warn_without_failing() {
    let (definition, warnings) = parse("name: Mine\nprompt: x\nsmith: Ada\ntimeout: 5m");
    assert!(definition.is_ok());
    assert_eq!(
        warnings,
        vec![
            "unknown key `smith`".to_string(),
            "unknown key `timeout`".to_string()
        ]
    );
}

#[test]
fn limits_over_the_cap_are_clamped_with_a_warning() {
    let (definition, warnings) = parse("name: Mine\nprompt: x\ntime_limit: 2h\nmax_rounds: 9");
    let definition = definition.unwrap();
    assert_eq!(definition.time_limit_secs, TIME_LIMIT_CAP_SECS);
    assert_eq!(definition.max_rounds, MAX_ROUNDS_CAP);
    assert_eq!(warnings.len(), 2, "{warnings:?}");
}

#[test]
fn invalid_values_are_errors_that_name_the_key() {
    for (yaml, key) in [
        ("name: M\nprompt: x\nmax_rounds: 0", "max_rounds"),
        ("name: M\nprompt: x\ntime_limit: soon", "time_limit"),
        ("name: M\nprompt: x\ntime_limit: 15", "time_limit"),
        ("name: M\nprompt: x\nwhen: push", "when"),
        ("name: M\nprompt: x\nresult: score", "result"),
        ("name: M\nprompt: x\nmin_severity: nit", "min_severity"),
        ("name: M\nprompt: x\ndefault: maybe", "default"),
        ("name: M\nprompt: x\npaths: ['src/[']", "paths"),
        ("name: M\nprompt: x\nversion: 2", "version"),
    ] {
        let error = error(yaml);
        assert!(error.contains(key), "{yaml}: {error}");
    }
}

#[test]
fn a_keeper_needs_a_name_and_a_prompt() {
    assert!(error("prompt: x").contains("name"));
    assert!(error("name: Mine").contains("prompt"));
    assert!(error("- a list").contains("mapping"));
}

#[test]
fn an_unknown_placeholder_is_rejected() {
    let error = error("name: Mine\nprompt: Check {{plan}}.");
    assert!(error.contains("{{plan}}"), "{error}");
}

#[test]
fn default_accepts_on_off_and_booleans() {
    assert!(valid("name: M\nprompt: x\ndefault: on").default_on);
    assert!(!valid("name: M\nprompt: x\ndefault: off").default_on);
    assert!(!valid("name: M\nprompt: x\ndefault: false").default_on);
}

#[test]
fn a_two_line_preset_file_is_the_built_in() {
    let definition = valid("version: 1\npreset: review");
    assert_eq!(definition.name, "Review");
    assert_eq!(definition.preset.as_deref(), Some("review"));
    assert_eq!(definition.when, wire::KeeperWhen::Commit);
    assert!(definition.prompt.starts_with(PREAMBLE.trim_end()));
    assert!(definition
        .prompt
        .contains("A finding without a concrete failure"));
}

#[test]
fn instructions_append_to_the_preset_and_prompt_replaces_it() {
    let appended = valid("preset: review\ninstructions: Watch the SQL.");
    assert!(appended
        .prompt
        .contains("A finding without a concrete failure"));
    assert!(appended.prompt.ends_with("Watch the SQL.\n"));

    let replaced = valid("preset: review\nprompt: Only the SQL.");
    assert!(!replaced
        .prompt
        .contains("A finding without a concrete failure"));
    assert!(replaced.prompt.starts_with(PREAMBLE.trim_end()));
    assert!(replaced.prompt.ends_with("Only the SQL.\n"));
}

#[test]
fn file_values_override_the_presets() {
    let definition = valid("preset: slop\nname: Tidy\nmin_severity: medium\nmax_rounds: 1");
    assert_eq!(definition.name, "Tidy");
    assert_eq!(definition.min_severity, wire::KeeperSeverity::Medium);
    assert_eq!(definition.max_rounds, 1);
    assert_eq!(
        valid("preset: slop").min_severity,
        wire::KeeperSeverity::Low
    );
}

#[test]
fn a_missing_preset_is_an_error_listing_the_built_ins() {
    let error = error("preset: nuclear");
    assert!(error.contains("nuclear"), "{error}");
    assert!(
        error.contains("review, slop, conventions, security"),
        "{error}"
    );
}

#[test]
fn every_preset_resolves_from_a_file_naming_it() {
    use wire::{KeeperResultKind as Kind, KeeperWhen as When};
    let expected = [
        ("review", When::Commit, Kind::Findings),
        ("slop", When::Commit, Kind::Findings),
        ("conventions", When::Commit, Kind::Findings),
        ("security", When::Ready, Kind::PassFail),
        ("thermonuclear", When::Ready, Kind::Findings),
        ("intent", When::Ready, Kind::PassFail),
        ("verify", When::Ready, Kind::Verdict),
        ("pr-ready", When::Ready, Kind::Draft),
    ];
    assert_eq!(PRESETS.len(), expected.len());
    for (id, when, result) in expected {
        let definition = valid(&format!("version: 1\npreset: {id}"));
        assert_eq!(definition.preset.as_deref(), Some(id));
        assert_eq!((definition.when, definition.result), (when, result), "{id}");
    }
}

fn write(dir: &std::path::Path, name: &str, text: &str) {
    std::fs::write(dir.join(name), text).unwrap();
}

#[test]
fn a_project_lists_only_its_own_files() {
    let project = tempfile::tempdir().unwrap();
    assert!(list_keepers(project.path()).is_empty());

    let dir = keepers_dir(project.path());
    std::fs::create_dir_all(&dir).unwrap();
    write(&dir, "review.yaml", "version: 1\npreset: review");
    write(&dir, "review.yml", "version: 1\npreset: slop");
    write(&dir, "broken.yaml", "preset: nope");
    write(&dir, "notes.txt", "not a keeper");

    let listed = list_keepers(project.path());
    let ids: Vec<&str> = listed.iter().map(|k| k.id.as_str()).collect();
    assert_eq!(ids, ["broken", "review"]);
    assert!(listed[0].definition.is_none());
    assert!(listed[0].error.as_deref().unwrap().contains("nope"));
    let review = listed[1].definition.as_ref().unwrap();
    assert_eq!(review.preset.as_deref(), Some("review"));
    assert_eq!(
        listed[1].warnings,
        vec!["duplicate keeper file ignored: review.yml".to_string()]
    );
}

fn run(id: &str, keeper_id: &str) -> wire::KeeperRun {
    wire::KeeperRun {
        id: id.into(),
        keeper_id: keeper_id.into(),
        ..Default::default()
    }
}

fn finding(run_id: &str, status: Status, resolved_at: u64) -> wire::KeeperFinding {
    wire::KeeperFinding {
        id: format!("{run_id}-{resolved_at}"),
        run_id: run_id.into(),
        status,
        resolved_at: Some(resolved_at),
        ..Default::default()
    }
}

#[test]
fn precision_counts_resolved_findings_per_keeper_across_tasks() {
    let first = KeeperState {
        runs: vec![run("r1", "review"), run("r2", "slop")],
        findings: vec![
            finding("r1", Status::Fixed, 1),
            finding("r1", Status::Dismissed, 2),
            finding("r1", Status::Open, 3),
            finding("r1", Status::Sent, 4),
            finding("r2", Status::Superseded, 5),
            finding("gone", Status::Fixed, 6),
        ],
    };
    let second = KeeperState {
        runs: vec![run("r3", "review")],
        findings: vec![finding("r3", Status::Fixed, 7)],
    };
    let precision = precision([&first, &second]);
    assert_eq!(
        precision,
        vec![wire::KeeperPrecision {
            keeper_id: "review".into(),
            fixed: 2,
            dismissed: 1,
        }]
    );
    assert_eq!(precision[0].value(), Some(2.0 / 3.0));
}

#[test]
fn precision_reads_only_the_newest_fifty_resolutions() {
    let mut state = KeeperState {
        runs: vec![run("r1", "review")],
        findings: Vec::new(),
    };
    for at in 0..20 {
        state.put_finding(finding("r1", Status::Dismissed, at));
    }
    for at in 20..70 {
        state.put_finding(finding("r1", Status::Fixed, at));
    }
    let precision = precision([&state]);
    assert_eq!(precision[0].fixed, PRECISION_WINDOW as u32);
    assert_eq!(precision[0].dismissed, 0);
}
