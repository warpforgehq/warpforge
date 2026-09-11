use warpforge_protocol as wire;

use super::parse::extract_last_json_with_key;
use super::{Finding, Severity, DIFF_CONTEXT_MAX_BYTES, SUMMARY_CONTEXT_MAX_BYTES};

// ─── Context formatting ──────────────────────────────────────────────────────

/// Render a working-copy diff into prompt text, truncated to
/// [`DIFF_CONTEXT_MAX_BYTES`] with an explicit truncation note.
pub fn format_diff(files: &[wire::FileDiff]) -> String {
    if files.is_empty() {
        return "(no changes in the working copy)".to_string();
    }
    let mut out = String::new();
    let mut truncated = false;
    'files: for file in files {
        let header = match (&file.status, &file.old_path) {
            (wire::FileDiffStatus::Renamed, Some(old)) => {
                format!("--- {old}\n+++ {} (renamed)\n", file.path)
            }
            (wire::FileDiffStatus::Added, _) => format!("+++ {} (added)\n", file.path),
            (wire::FileDiffStatus::Deleted, _) => format!("--- {} (deleted)\n", file.path),
            _ => format!("--- a/{p}\n+++ b/{p}\n", p = file.path),
        };
        out.push_str(&header);
        for hunk in &file.hunks {
            out.push_str(&format!(
                "@@ -{},{} +{},{} @@\n",
                hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
            ));
            for line in &hunk.lines {
                out.push_str(line);
                out.push('\n');
            }
            if out.len() > DIFF_CONTEXT_MAX_BYTES {
                truncated = true;
                break 'files;
            }
        }
        out.push('\n');
    }
    if truncated {
        out.truncate(floor_char_boundary(&out, DIFF_CONTEXT_MAX_BYTES));
        out.push_str("\n\n[diff truncated — full list of changed files:]\n");
        for file in files {
            out.push_str(&format!("- {}\n", file.path));
        }
    }
    out
}

/// Strip the trailing machine protocol block (the `verdict` / `need_user_input`
/// JSON fence) so the parent's timeline shows the agent's prose instead of the
/// wire format it was asked to emit. Falls back to the full text when nothing
/// matches, and always clips to the summary budget.
pub fn display_output(text: &str) -> String {
    let trimmed = strip_protocol_blocks(text).trim().to_string();
    let trimmed = trimmed.as_str();
    if trimmed.is_empty() {
        // The whole reply was the protocol block — show it rather than an
        // empty card.
        return clip_summary(text.trim());
    }
    clip_summary(trimmed)
}

/// Drop the trailing machine protocol fences from an agent reply.
pub(super) fn strip_protocol_blocks(text: &str) -> &str {
    let mut visible = text;
    for key in ["verdict", "need_user_input"] {
        if let Some(start) = protocol_block_start(visible, key) {
            visible = &visible[..start];
        }
    }
    visible
}

/// Byte offset of the fence that opens the last JSON block containing `key`.
fn protocol_block_start(text: &str, key: &str) -> Option<usize> {
    let mut found = None;
    let mut cursor = 0;
    while let Some(open) = text[cursor..].find("```").map(|p| cursor + p) {
        let after_open = open + 3;
        let Some(nl) = text[after_open..].find('\n').map(|p| after_open + p + 1) else {
            break;
        };
        let Some(close) = text[nl..].find("```").map(|p| nl + p) else {
            break;
        };
        if serde_json::from_str::<serde_json::Value>(text[nl..close].trim())
            .ok()
            .and_then(|value| value.get(key).cloned())
            .is_some()
        {
            found = Some(open);
        }
        cursor = close + 3;
    }
    found
}

/// Keep the tail of a long implementer summary (the conclusion matters most).
pub fn clip_summary(summary: &str) -> String {
    if summary.len() <= SUMMARY_CONTEXT_MAX_BYTES {
        return summary.to_string();
    }
    let start = ceil_char_boundary(summary, summary.len() - SUMMARY_CONTEXT_MAX_BYTES);
    format!("[…truncated…]\n{}", &summary[start..])
}

pub(super) fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_char_boundary(s: &str, mut i: usize) -> usize {
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

pub fn format_findings(findings: &[Finding]) -> String {
    findings
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let location = match (f.file.as_deref(), f.line) {
                (Some(path), Some(line)) => format!(" `{path}:{line}`"),
                (Some(path), None) => format!(" `{path}`"),
                (None, _) => String::new(),
            };
            let mut entry = format!(
                "{}. [{}]{} — {} ({})",
                i + 1,
                f.severity.label(),
                location,
                f.description,
                f.reviewer
            );
            if let Some(snippet) = f.snippet.as_deref() {
                // A verbatim excerpt survives line drift: the fixer can search
                // for it even after the file has moved underneath the number.
                entry.push_str(&format!("\n   at: `{snippet}`"));
            }
            entry
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Keep a code anchor short: a reviewer that pastes a whole function would
/// otherwise dominate the repair prompt.
pub(super) fn clip_snippet(snippet: &str) -> String {
    const MAX: usize = 200;
    let one_line = snippet.replace('\n', " ").trim().to_string();
    if one_line.len() <= MAX {
        return one_line;
    }
    let end = floor_char_boundary(&one_line, MAX);
    format!("{}…", &one_line[..end])
}

/// True when `text` carries either machine protocol payload. Used to decide
/// whether an agent's closing message is the authoritative output or whether
/// the payload only appears earlier in the turn.
pub fn has_protocol_payload(text: &str) -> bool {
    extract_last_json_with_key(text, "verdict").is_some()
        || extract_last_json_with_key(text, "need_user_input").is_some()
}

/// Short one-line findings summary for the limit-decision prompt.
pub fn summarize_findings(findings: &[Finding]) -> String {
    let mut counts: [usize; 4] = [0; 4];
    for f in findings {
        counts[match f.severity {
            Severity::Critical => 0,
            Severity::High => 1,
            Severity::Medium => 2,
            Severity::Low => 3,
        }] += 1;
    }
    let parts: Vec<String> = [
        (counts[0], "critical"),
        (counts[1], "high"),
        (counts[2], "medium"),
        (counts[3], "low"),
    ]
    .iter()
    .filter(|(n, _)| *n > 0)
    .map(|(n, label)| format!("{n} {label}"))
    .collect();
    if parts.is_empty() {
        "no open findings".to_string()
    } else {
        format!("open findings: {}", parts.join(", "))
    }
}
