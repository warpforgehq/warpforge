use warpforge_protocol as wire;
use wire::{KeeperLoop, KeeperRun, KeeperSeverity, KeeperStop};

/// One finding going to the fixer, with the keeper that raised it.
#[derive(Debug, Clone)]
pub struct FixItem<'a> {
    pub keeper: &'a str,
    pub finding: &'a wire::KeeperFinding,
}

/// The one prompt that carries every keeper's findings on a HEAD into the
/// task's own session (ADR 0030, *The fixer*).
/// @param head the HEAD the findings were computed on
/// @param items the findings to fix or rebut
/// @param guidance (keeper name, the owner's note) pairs from Extend
/// @returns the text sent as a `Keeper` turn
pub fn fix_prompt(head: &str, items: &[FixItem<'_>], guidance: &[(&str, &str)]) -> String {
    let intro = |short: &str| {
        format!(
            "Keepers checked commit {short} and found the problems below. For each one, either \
fix it or, if it is not a real problem, rebut it by explaining why. Change nothing else.\n\n"
        )
    };
    prompt(head, intro, items, guidance)
}

/// The prompt the owner sends by hand with **Send to agent**: the findings
/// may predate HEAD, so the agent first checks each still holds.
/// @param head the HEAD the findings were computed on
/// @param items the findings to fix or rebut
/// @param guidance (keeper name, the owner's note) pairs from Extend
/// @param dirty the shared checkout has uncommitted changes the agent must leave alone
/// @returns the text sent as a `Keeper` turn
pub fn owner_fix_prompt(
    head: &str,
    items: &[FixItem<'_>],
    guidance: &[(&str, &str)],
    dirty: bool,
) -> String {
    let intro = |short: &str| {
        let others = if dirty {
            "The working tree has uncommitted changes that are not yours: leave them alone, and \
commit only the files you change for these findings, staged by path.\n\n"
        } else {
            ""
        };
        format!(
            "Keepers checked commit {short} and found the problems below; the owner sent them to \
you. HEAD may have moved since {short}, so first check whether each one still holds in the \
current code. For each that does, either fix it or, if it is not a real problem, rebut it by \
explaining why; for each that no longer holds, say so. Change nothing else.\n\n{others}"
        )
    };
    prompt(head, intro, items, guidance)
}

fn prompt(
    head: &str,
    intro: impl Fn(&str) -> String,
    items: &[FixItem<'_>],
    guidance: &[(&str, &str)],
) -> String {
    let mut out = intro(&head[..head.len().min(10)]);
    for (index, item) in items.iter().enumerate() {
        let f = item.finding;
        let place = super::prompt::at(f)
            .map(|at| format!(" {at} —"))
            .unwrap_or_default();
        out.push_str(&format!(
            "[{}] [{}, {}]{place} {}\n",
            index + 1,
            item.keeper,
            severity(f.severity),
            f.description.trim()
        ));
    }
    if !guidance.is_empty() {
        out.push_str("\nThe owner's guidance on these findings (context, not new work):\n");
        for (keeper, note) in guidance {
            out.push_str(&format!("- {keeper}: {}\n", note.trim()));
        }
    }
    out.push_str(
        "\nThen run the project's checks and make them pass, and commit your fixes. Never use \
--no-verify. Do not push. If you rebut every finding, change nothing and do not commit.",
    );
    out.push_str(REPLY_FORMAT);
    out
}

const REPLY_FORMAT: &str = "\n\nEnd your reply with one fenced json block that lists, by \
number, only the findings you did not fix, for example:\n```json\n{\"keepers\": [{\"n\": 2, \
\"verdict\": \"rebutted\", \"reason\": \"the input is validated by the caller\"}, {\"n\": 4, \
\"verdict\": \"stale\", \"reason\": \"fixed in an earlier commit\"}]}\n```\nUse \"rebutted\" \
when a finding is not a real problem and \"stale\" when it no longer holds in the current code. \
Leave out the ones you fixed; if you fixed them all, the list is empty.";

fn severity(severity: KeeperSeverity) -> &'static str {
    match severity {
        KeeperSeverity::Critical => "critical",
        KeeperSeverity::High => "high",
        KeeperSeverity::Medium => "medium",
        KeeperSeverity::Low => "low",
    }
}

/// Whether a keeper's loop must stop before another round (ADR 0030, *Cost,
/// stop rules, escalation*). Asked only when the round would count.
/// @param fix the keeper's loop on the task
/// @param max_rounds the keeper's `max_rounds`
/// @param current the run whose findings would be sent
/// @param previous the keeper's counted run before it
/// @param reraised whether `current` repeats a finding already sent to fix
/// @returns the reason to stop, if any
pub fn stop_rule(
    fix: &KeeperLoop,
    max_rounds: u32,
    current: &KeeperRun,
    previous: Option<&KeeperRun>,
    reraised: bool,
) -> Option<KeeperStop> {
    if fix.rounds >= max_rounds + fix.extra_rounds {
        return Some(KeeperStop::MaxRounds);
    }
    let judged = fix.rounds > 0 && fix.extended_run.as_deref() != Some(current.id.as_str());
    let stalled = previous.is_some_and(|p| current.count >= p.count);
    (judged && (reraised || stalled)).then_some(KeeperStop::NoProgress)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, count: u32) -> KeeperRun {
        KeeperRun {
            id: id.into(),
            count,
            ..Default::default()
        }
    }

    #[test]
    fn the_prompt_lists_every_finding_and_the_rules() {
        let a = wire::KeeperFinding {
            file: Some("src/lib.rs".into()),
            line: Some(4),
            severity: KeeperSeverity::High,
            description: "panics on empty input".into(),
            ..Default::default()
        };
        let b = wire::KeeperFinding {
            description: "comment restates the line".into(),
            severity: KeeperSeverity::Low,
            ..Default::default()
        };
        let items = [
            FixItem {
                keeper: "Review",
                finding: &a,
            },
            FixItem {
                keeper: "Slop",
                finding: &b,
            },
        ];
        let prompt = fix_prompt("abcdef0123456789", &items, &[("Review", "keep the API")]);
        assert!(prompt.contains("commit abcdef0123 "), "{prompt}");
        assert!(prompt.contains("[1] [Review, high] src/lib.rs:4 — panics on empty input"));
        assert!(prompt.contains("[2] [Slop, low] comment restates the line"));
        assert!(prompt.contains("- Review: keep the API"));
        assert!(prompt.contains("Never use --no-verify. Do not push."));
        assert!(prompt.ends_with("if you fixed them all, the list is empty."));
    }

    #[test]
    fn the_owners_prompt_names_the_commit_and_asks_to_recheck() {
        let a = wire::KeeperFinding {
            description: "panics on empty input".into(),
            severity: KeeperSeverity::High,
            ..Default::default()
        };
        let items = [FixItem {
            keeper: "Security",
            finding: &a,
        }];
        let prompt = owner_fix_prompt("abcdef0123456789", &items, &[], false);
        assert!(
            prompt.starts_with("Keepers checked commit abcdef0123 "),
            "{prompt}"
        );
        assert!(
            prompt.contains("HEAD may have moved since abcdef0123"),
            "{prompt}"
        );
        assert!(prompt.contains("[1] [Security, high] panics on empty input"));
        assert!(prompt.contains("Never use --no-verify. Do not push."));
        assert!(prompt.contains("{\"keepers\": [{\"n\": 2, \"verdict\": \"rebutted\""));
    }

    #[test]
    fn rounds_stop_at_the_limit_plus_extensions() {
        let mut fix = KeeperLoop {
            rounds: 3,
            ..Default::default()
        };
        let current = run("r4", 1);
        let stop = stop_rule(&fix, 3, &current, None, false);
        assert_eq!(stop, Some(KeeperStop::MaxRounds));
        fix.extra_rounds = 1;
        fix.extended_run = Some("r4".into());
        assert_eq!(stop_rule(&fix, 3, &current, None, false), None);
    }

    #[test]
    fn no_progress_needs_a_round_and_skips_the_extended_run() {
        let fresh = KeeperLoop::default();
        let (previous, current) = (run("r1", 2), run("r2", 2));
        let stop = stop_rule(&fresh, 3, &current, Some(&previous), true);
        assert_eq!(stop, None, "no round yet");
        let mut fix = KeeperLoop {
            rounds: 1,
            ..Default::default()
        };
        let stop = stop_rule(&fix, 3, &current, Some(&previous), false);
        assert_eq!(stop, Some(KeeperStop::NoProgress));
        let fewer = run("r2", 1);
        assert_eq!(stop_rule(&fix, 3, &fewer, Some(&previous), false), None);
        let stop = stop_rule(&fix, 3, &fewer, Some(&previous), true);
        assert_eq!(stop, Some(KeeperStop::NoProgress), "a re-raised finding");
        fix.extended_run = Some("r2".into());
        assert_eq!(stop_rule(&fix, 3, &current, Some(&previous), true), None);
    }
}
