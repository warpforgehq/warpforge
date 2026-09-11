use std::collections::{HashMap, HashSet};

// ─── Prompt templates ────────────────────────────────────────────────────────

/// Placeholders each stage's custom prompt may use. An unknown placeholder is
/// a validation error — silently rendering `{{typo}}` verbatim into an agent
/// prompt would be far harder to notice.
pub const VARS_PLAN: &[&str] = &["task_prompt"];
pub const VARS_IMPLEMENT: &[&str] = &["task_prompt", "plan"];
pub const VARS_REVIEW: &[&str] = &[
    "task_prompt",
    "plan",
    "implementer_summary",
    "diff",
    "round",
    "max_rounds",
    "focus",
];
pub const VARS_FIX: &[&str] = &[
    "task_prompt",
    "plan",
    "implementer_summary",
    "diff",
    "findings",
    "round",
    "max_rounds",
];

pub(super) fn validate_prompt(
    prompt: Option<&str>,
    stage: &str,
    allowed: &[&'static str],
) -> Result<(), String> {
    let Some(prompt) = prompt else {
        return Ok(());
    };
    for name in extract_placeholders(prompt) {
        if !allowed.contains(&name.as_str()) {
            return Err(format!(
                "unknown placeholder {{{{{name}}}}} in {stage} prompt (allowed: {})",
                allowed.join(", ")
            ));
        }
    }
    Ok(())
}

/// `{{name}}` occurrences as (start, end-exclusive, trimmed name). Only
/// identifier-shaped names count; other `{{…}}` text is left alone.
fn scan_placeholders(template: &str) -> Vec<(usize, usize, String)> {
    let mut found = Vec::new();
    let bytes = template.as_bytes();
    let mut i = 0;
    while let Some(open) = template[i..].find("{{").map(|p| i + p) {
        let Some(close) = template[open + 2..].find("}}").map(|p| open + 2 + p) else {
            break;
        };
        let name = template[open + 2..close].trim();
        let is_ident =
            !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if is_ident {
            found.push((open, close + 2, name.to_string()));
            i = close + 2;
        } else {
            // Skip just the opening braces so `{{ {{diff}}` still finds the
            // inner placeholder.
            i = open + 2;
        }
        if i >= bytes.len() {
            break;
        }
    }
    found
}

/// Distinct placeholder names used in a template, in order of first use.
pub fn extract_placeholders(template: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    scan_placeholders(template)
        .into_iter()
        .map(|(_, _, name)| name)
        .filter(|name| seen.insert(name.clone()))
        .collect()
}

/// Substitute `{{name}}` placeholders. Names missing from `vars` are left
/// verbatim (validation has already rejected unknown names at load time).
/// Consumed by the workflow engine when it renders stage prompts.
#[allow(dead_code)]
pub fn render_template(template: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = String::with_capacity(template.len());
    let mut last = 0;
    for (start, end, name) in scan_placeholders(template) {
        if let Some(value) = vars.get(name.as_str()) {
            out.push_str(&template[last..start]);
            out.push_str(value);
            last = end;
        }
    }
    out.push_str(&template[last..]);
    out
}
