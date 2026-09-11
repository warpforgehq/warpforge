use super::format::{clip_snippet, floor_char_boundary, strip_protocol_blocks};
use super::{Finding, Severity, StageSignal, Verdict};

/// Budget for a salvaged review body used as a stand-in finding.
const SALVAGED_FINDING_MAX_BYTES: usize = 4 * 1024;

// ─── Output parsing ──────────────────────────────────────────────────────────

/// Scan a stage's output for the trailing `need_user_input` marker.
pub fn parse_stage_signal(text: &str) -> StageSignal {
    if let Some(value) = extract_last_json_with_key(text, "need_user_input") {
        if let Some(q) = value.get("need_user_input").and_then(|v| v.as_str()) {
            let q = q.trim();
            // Ignore an agent that echoes the protocol example back at us
            // instead of asking something.
            if !q.is_empty() && q != "<your question>" {
                return StageSignal::Question(q.to_string());
            }
        }
    }
    StageSignal::Output
}

/// Parse a reviewer's verdict from its output. `Err` is a human-readable
/// reason suitable for the re-ask prompt / failure message.
pub fn parse_review_verdict(text: &str, reviewer: &str) -> Result<(Verdict, Vec<Finding>), String> {
    let Some(value) = extract_last_json_with_key(text, "verdict") else {
        return Err("no fenced JSON block with a `verdict` field found".to_string());
    };
    let verdict = match value.get("verdict").and_then(|v| v.as_str()) {
        Some("approve") => Verdict::Approve,
        Some("request_changes") => Verdict::RequestChanges,
        Some(other) => {
            return Err(format!(
                "verdict must be \"approve\" or \"request_changes\", got \"{other}\""
            ))
        }
        None => return Err("the `verdict` field is not a string".to_string()),
    };
    let mut findings = Vec::new();
    if let Some(items) = value.get("findings").and_then(|v| v.as_array()) {
        for item in items {
            let description = item
                .get("description")
                .or_else(|| item.get("title"))
                .or_else(|| item.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            if description.is_empty() {
                continue;
            }
            findings.push(Finding {
                severity: item
                    .get("severity")
                    .and_then(|v| v.as_str())
                    .map(Severity::parse)
                    .unwrap_or(Severity::Medium),
                file: item
                    .get("file")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .filter(|f| !f.is_empty()),
                // Agents emit the line as a number or a string, and sometimes
                // as a range ("42-45") — the first number is the anchor.
                line: item
                    .get("line")
                    .and_then(|v| {
                        v.as_u64().or_else(|| {
                            v.as_str().and_then(|s| {
                                s.trim()
                                    .split(|c: char| !c.is_ascii_digit())
                                    .find(|part| !part.is_empty())
                                    .and_then(|part| part.parse().ok())
                            })
                        })
                    })
                    .and_then(|n| u32::try_from(n).ok())
                    .filter(|n| *n > 0),
                snippet: item
                    .get("snippet")
                    .or_else(|| item.get("code"))
                    .and_then(|v| v.as_str())
                    .map(|s| clip_snippet(s.trim()))
                    .filter(|s| !s.is_empty()),
                description,
                reviewer: reviewer.to_string(),
            });
        }
    }
    // A reviewer that asks for changes but leaves `findings` empty (prose-only
    // review, a differently-named key, entries without a description) must not
    // read as "nothing to fix" — that path finishes the pipeline as a success
    // and silently rubber-stamps the change. Salvage its own words instead so
    // the repair stage still has something concrete to act on.
    if verdict == Verdict::RequestChanges && findings.is_empty() {
        let prose = strip_protocol_blocks(text).trim().to_string();
        let prose = if prose.len() > SALVAGED_FINDING_MAX_BYTES {
            let end = floor_char_boundary(&prose, SALVAGED_FINDING_MAX_BYTES);
            format!("{}\n[…truncated…]", &prose[..end])
        } else {
            prose
        };
        findings.push(Finding {
            severity: Severity::Medium,
            file: None,
            line: None,
            snippet: None,
            description: if prose.is_empty() {
                "Changes were requested without any detail. Re-check the diff against the task \
                 and fix what looks wrong."
                    .to_string()
            } else {
                format!(
                    "Changes requested without a structured findings list — the reviewer's own \
                     words follow:\n\n{prose}"
                )
            },
            reviewer: reviewer.to_string(),
        });
    }

    Ok((verdict, findings))
}

/// The last fenced code block in `text` that parses as a JSON object
/// containing `key`. Requiring the key matters: agents routinely end a reply
/// with an unrelated fenced block (a config snippet, a quoted diff), and
/// taking the last JSON object unconditionally would misread that as the
/// protocol payload. Accepts both ```json and bare ``` fences — agents are
/// inconsistent.
pub(super) fn extract_last_json_with_key(text: &str, key: &str) -> Option<serde_json::Value> {
    let mut best: Option<serde_json::Value> = None;
    let mut rest = text;
    while let Some(open) = rest.find("```") {
        let after_open = &rest[open + 3..];
        // Skip the info string ("json", "JSON", …) up to the first newline.
        let Some(nl) = after_open.find('\n') else {
            break;
        };
        let body_start = nl + 1;
        let Some(close) = after_open[body_start..].find("```") else {
            break;
        };
        let body = &after_open[body_start..body_start + close];
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(body.trim()) {
            if value.get(key).is_some() {
                best = Some(value);
            }
        }
        rest = &after_open[body_start + close + 3..];
    }
    best
}

/// Merge one round's reviewer results: approve only when everyone approves;
/// findings are concatenated in reviewer order.
pub fn merge_reviews(collected: &[(usize, Verdict, Vec<Finding>)]) -> (Verdict, Vec<Finding>) {
    let mut sorted: Vec<_> = collected.iter().collect();
    sorted.sort_by_key(|(idx, _, _)| *idx);
    let verdict = if sorted
        .iter()
        .all(|(_, verdict, _)| *verdict == Verdict::Approve)
    {
        Verdict::Approve
    } else {
        Verdict::RequestChanges
    };
    let findings = sorted
        .iter()
        .flat_map(|(_, _, findings)| findings.iter().cloned())
        .collect();
    (verdict, findings)
}
