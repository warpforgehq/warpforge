use std::collections::HashMap;

use warpforge_protocol as wire;
use wire::KeeperResultKind as Kind;

use crate::workflow_config::render_template;

/// Values for a keeper prompt's placeholders.
#[derive(Debug, Default, Clone)]
pub struct PromptVars {
    pub task_title: String,
    pub task_brief: String,
    pub diff: String,
    pub commits: String,
    pub dismissed: String,
    pub rules: String,
}

const FINDINGS_PROTOCOL: &str = "Do not edit files, commit or push; read the code and run \
read-only checks only.\n\n\
You MUST end your reply with exactly one fenced code block, and nothing after it, of this \
shape:\n\
```json\n{\"verdict\": \"request_changes\", \"findings\": [{\"severity\": \"high\", \"file\": \
\"src/example.rs\", \"line\": 42, \"snippet\": \"if attempts > max {\", \"description\": \
\"what is wrong and why\"}]}\n```\n\
`line` is the line in the file after the change. When nothing is wrong, send \
`{\"verdict\": \"approve\", \"findings\": []}`. `findings` MUST be a JSON array and every \
entry MUST carry a `description`; anything written only in prose is not recorded. \
`severity` is critical, high, medium or low, and `file` may be null.";

const VERDICT_PROTOCOL: &str = "Do not edit files, commit or push.\n\n\
You MUST end your reply with exactly one fenced code block, and nothing after it, of this \
shape:\n\
```json\n{\"verdict\": \"fail\", \"summary\": \"what you checked and what you saw\", \
\"checklist\": [], \"findings\": [{\"severity\": \"high\", \"file\": null, \"description\": \
\"what you did, what you expected, what happened\"}]}\n```\n\
`verdict` is `pass`, `fail` (each problem in `findings`) or `blocked` when you could not run \
the check at all, with the reason in `summary`.";

/// The checker's prompt for one run: the keeper's template rendered, then
/// the protocol for its `result`.
/// @param definition the resolved keeper
/// @param vars the run's values
/// @returns the text sent to the checker's session
pub fn render_prompt(definition: &wire::KeeperDefinition, vars: &PromptVars) -> String {
    let none = |text: &str| match text.trim() {
        "" => "(none)".to_string(),
        text => text.to_string(),
    };
    let values: HashMap<&str, String> = HashMap::from([
        ("name", definition.name.clone()),
        ("task_title", none(&vars.task_title)),
        ("task_brief", none(&vars.task_brief)),
        ("diff", none(&vars.diff)),
        ("commits", none(&vars.commits)),
        ("dismissed", none(&vars.dismissed)),
        ("rules", none(&vars.rules)),
    ]);
    let body = render_template(&definition.prompt, &values);
    format!("{}\n\n{}", body.trim_end(), protocol(definition.result))
}

fn protocol(kind: Kind) -> &'static str {
    match kind {
        Kind::Verdict => VERDICT_PROTOCOL,
        Kind::Findings | Kind::PassFail | Kind::Draft => FINDINGS_PROTOCOL,
    }
}

/// Asked once when a checker's reply had no readable verdict.
/// @param kind the keeper's `result`
/// @param reason why the reply could not be read
/// @returns the follow-up prompt
pub fn reask_prompt(kind: Kind, reason: &str) -> String {
    match kind {
        Kind::Verdict => crate::daemon::workflow::reask_verify_prompt(reason),
        _ => crate::daemon::workflow::reask_verdict_prompt(reason),
    }
}

/// The commits a run has not seen yet.
/// @param log `<sha> <subject>` lines, newest first, merge-base..HEAD
/// @param previous the HEAD the keeper's previous run checked
/// @returns the lines above `previous`, or all of them when it is not listed
pub fn commits_since(log: &[String], previous: Option<&str>) -> String {
    let newer = log
        .iter()
        .take_while(|line| previous.is_none_or(|sha| !line.starts_with(sha)));
    newer.cloned().collect::<Vec<_>>().join("\n")
}

/// Findings the owner dismissed, for "do not raise these again".
/// @param findings the keeper's findings on this task
/// @returns one line per dismissed finding
pub fn dismissed_list(findings: &[&wire::KeeperFinding]) -> String {
    findings
        .iter()
        .filter(|f| f.status == wire::KeeperFindingStatus::Dismissed)
        .map(|f| {
            let place = match (&f.file, f.line) {
                (Some(file), Some(line)) => format!("{file}:{line} — "),
                (Some(file), None) => format!("{file} — "),
                _ => String::new(),
            };
            match &f.dismiss_reason {
                Some(reason) => format!("- {place}{} (owner: {reason})", f.description),
                None => format!("- {place}{}", f.description),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commits_since_stops_at_the_previous_head() {
        let log: Vec<String> = ["ccc3 third", "bbb2 second", "aaa1 first"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(commits_since(&log, Some("bbb2")), "ccc3 third");
        assert_eq!(commits_since(&log, None).lines().count(), 3);
        assert_eq!(commits_since(&log, Some("zzz")).lines().count(), 3);
    }

    #[test]
    fn the_prompt_carries_the_change_and_the_protocol() {
        let (definition, _) =
            crate::daemon::keepers::parse_keeper("review", "version: 1\npreset: review\n");
        let definition = definition.unwrap();
        let prompt = render_prompt(
            &definition,
            &PromptVars {
                task_title: "Parser".into(),
                diff: "+fn parse()".into(),
                dismissed: "- a.rs — not a bug".into(),
                ..Default::default()
            },
        );
        assert!(prompt.contains("You are Review"), "{prompt}");
        assert!(prompt.contains("+fn parse()"));
        assert!(prompt.contains("- a.rs — not a bug"));
        assert!(prompt.contains("Commits since your previous run:\n(none)"));
        assert!(prompt.trim_end().ends_with("may be null."), "{prompt}");
    }
}
