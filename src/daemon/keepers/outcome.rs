use sha2::{Digest, Sha256};
use warpforge_protocol as wire;
use wire::{KeeperOutcome as Outcome, KeeperResultKind as Kind, KeeperSeverity};

use crate::daemon::workflow::{self, Finding, Severity, Verdict};

/// A checker's closing message read against its keeper's `result`.
#[derive(Debug, Clone, PartialEq)]
pub struct Mapped {
    pub outcome: Outcome,
    /// Findings at or above `min_severity`.
    pub count: u32,
    /// Every finding reported, the ones below `min_severity` included.
    pub findings: Vec<wire::KeeperFinding>,
    /// Why the run was inconclusive.
    pub error: Option<String>,
}

/// Map a checker's reply onto one of the five outcomes (ADR 0030, *Result
/// model*). `Err` is the parse failure, for the one re-ask.
/// @param keeper_id the keeper, part of each finding's key
/// @param kind the keeper's `result`
/// @param min_severity findings below it are kept but not counted
/// @param text the checker's turn text
/// @returns the outcome, its count and findings without run ids
pub fn map_result(
    keeper_id: &str,
    kind: Kind,
    min_severity: KeeperSeverity,
    text: &str,
) -> Result<Mapped, String> {
    let (outcome, findings, error) = match kind {
        Kind::Findings | Kind::PassFail => {
            let (verdict, findings) = workflow::parse_review_verdict(text, keeper_id)?;
            let red = match kind {
                Kind::PassFail => verdict == Verdict::RequestChanges,
                _ => findings.iter().any(|f| counts(f.severity, min_severity)),
            };
            let outcome = if red {
                Outcome::Findings
            } else {
                Outcome::Green
            };
            (outcome, findings, None)
        }
        Kind::Verdict => {
            let report = workflow::parse_verify_verdict(text, keeper_id)?;
            match report.verdict {
                wire::WorkflowVerifyVerdict::Pass => (Outcome::Green, Vec::new(), None),
                wire::WorkflowVerifyVerdict::Fail => (Outcome::Findings, report.findings, None),
                wire::WorkflowVerifyVerdict::Blocked => {
                    (Outcome::Inconclusive, Vec::new(), Some(report.summary))
                }
            }
        }
        Kind::Draft => return Err("a draft has no verdict".into()),
    };
    let count = findings
        .iter()
        .filter(|f| counts(f.severity, min_severity))
        .count() as u32;
    Ok(Mapped {
        outcome,
        count,
        findings: findings.iter().map(|f| finding(keeper_id, f)).collect(),
        error,
    })
}

fn severity(severity: Severity) -> KeeperSeverity {
    match severity {
        Severity::Critical => KeeperSeverity::Critical,
        Severity::High => KeeperSeverity::High,
        Severity::Medium => KeeperSeverity::Medium,
        Severity::Low => KeeperSeverity::Low,
    }
}

fn rank(severity: KeeperSeverity) -> u8 {
    match severity {
        KeeperSeverity::Critical => 3,
        KeeperSeverity::High => 2,
        KeeperSeverity::Medium => 1,
        KeeperSeverity::Low => 0,
    }
}

fn counts(found: Severity, min: KeeperSeverity) -> bool {
    rank(severity(found)) >= rank(min)
}

/// The key ignores the line, which moves with every edit above it.
fn finding(keeper_id: &str, f: &Finding) -> wire::KeeperFinding {
    let words: Vec<String> = f
        .description
        .split_whitespace()
        .map(str::to_lowercase)
        .collect();
    let mut hash = Sha256::new();
    for part in [keeper_id, f.file.as_deref().unwrap_or(""), &words.join(" ")] {
        hash.update(part.as_bytes());
        hash.update([0]);
    }
    let key: String = hash.finalize()[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    wire::KeeperFinding {
        key,
        severity: severity(f.severity),
        file: f.file.clone(),
        line: f.line,
        description: f.description.clone(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fence(json: &str) -> String {
        format!("Looked at it.\n```json\n{json}\n```")
    }

    const ONE_LOW: &str = r#"{"verdict": "request_changes", "findings": [{"severity": "low", "file": "a.rs", "line": 3, "description": "nit"}]}"#;
    const ONE_HIGH: &str = r#"{"verdict": "request_changes", "findings": [{"severity": "high", "file": "a.rs", "description": "panics on empty input"}, {"severity": "low", "description": "nit"}]}"#;

    #[test]
    fn findings_count_only_at_or_above_min_severity() {
        let green = map_result(
            "review",
            Kind::Findings,
            KeeperSeverity::Medium,
            &fence(ONE_LOW),
        );
        let green = green.unwrap();
        assert_eq!((green.outcome, green.count), (Outcome::Green, 0));
        assert_eq!(green.findings.len(), 1, "a low finding is still shown");

        let red = map_result(
            "review",
            Kind::Findings,
            KeeperSeverity::Medium,
            &fence(ONE_HIGH),
        );
        let red = red.unwrap();
        assert_eq!((red.outcome, red.count), (Outcome::Findings, 1));
        assert_eq!(red.findings[0].severity, KeeperSeverity::High);

        let slop = map_result("slop", Kind::Findings, KeeperSeverity::Low, &fence(ONE_LOW));
        assert_eq!(slop.unwrap().count, 1);

        let approve = fence(r#"{"verdict": "approve", "findings": []}"#);
        let approved = map_result("review", Kind::Findings, KeeperSeverity::Medium, &approve);
        assert_eq!(approved.unwrap().outcome, Outcome::Green);
    }

    #[test]
    fn pass_fail_follows_the_verdict() {
        let approve = fence(r#"{"verdict": "approve", "findings": []}"#);
        let pass = map_result("intent", Kind::PassFail, KeeperSeverity::Medium, &approve);
        assert_eq!(pass.unwrap().outcome, Outcome::Green);
        let fail = map_result(
            "intent",
            Kind::PassFail,
            KeeperSeverity::Medium,
            &fence(ONE_LOW),
        );
        assert_eq!(fail.unwrap().outcome, Outcome::Findings);
    }

    #[test]
    fn verify_verdicts_map_to_green_findings_and_inconclusive() {
        let verdict = |word: &str| {
            let json = format!(
                r#"{{"verdict": "{word}", "summary": "no browser", "checklist": [], "findings": [{{"severity": "high", "description": "broken"}}]}}"#
            );
            map_result(
                "verify",
                Kind::Verdict,
                KeeperSeverity::Medium,
                &fence(&json),
            )
            .unwrap()
        };
        assert_eq!(verdict("pass").outcome, Outcome::Green);
        let fail = verdict("fail");
        assert_eq!((fail.outcome, fail.count), (Outcome::Findings, 1));
        let blocked = verdict("blocked");
        assert_eq!(blocked.outcome, Outcome::Inconclusive);
        assert_eq!(blocked.error.as_deref(), Some("no browser"));
    }

    #[test]
    fn an_unparseable_reply_is_an_error_for_the_reask() {
        let err = map_result(
            "review",
            Kind::Findings,
            KeeperSeverity::Medium,
            "looks fine to me",
        );
        assert!(err.unwrap_err().contains("verdict"));
    }

    #[test]
    fn a_finding_keeps_its_key_when_its_line_and_spacing_move() {
        let a = fence(
            r#"{"verdict": "request_changes", "findings": [{"severity": "high", "file": "a.rs", "line": 3, "description": "Panics  on empty"}]}"#,
        );
        let b = fence(
            r#"{"verdict": "request_changes", "findings": [{"severity": "high", "file": "a.rs", "line": 9, "description": "panics on\nempty"}]}"#,
        );
        let key = |text: &str| {
            map_result("review", Kind::Findings, KeeperSeverity::Medium, text)
                .unwrap()
                .findings[0]
                .key
                .clone()
        };
        assert_eq!(key(&a), key(&b));
        let other = map_result("slop", Kind::Findings, KeeperSeverity::Medium, &a).unwrap();
        assert_ne!(other.findings[0].key, key(&a), "keys are per keeper");
    }
}
