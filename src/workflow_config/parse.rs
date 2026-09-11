use super::template::validate_prompt;
use super::{
    extract_placeholders, OnLimit, ReaskMode, ReviewConfig, ReviewContextItem, ReviewerConfig,
    StageConfig, WorkflowSpec, DEFAULT_MAX_ROUNDS, MAX_REVIEWERS, MAX_ROUNDS_CAP,
    SUPPORTED_VERSION, VARS_FIX, VARS_IMPLEMENT, VARS_PLAN, VARS_REVIEW,
};
use serde::Deserialize;

// ─── Raw YAML shape ──────────────────────────────────────────────────────────

/// Deserialize an optional mapping so that a bare `plan:` (YAML null) means
/// "present with defaults", while an absent key stays `None`.
fn nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    let value = Option::<T>::deserialize(deserializer)?;
    Ok(Some(value.unwrap_or_default()))
}

/// Like [`nullable`], but `false` means "this stage is off". Deleting the key
/// is the canonical way to disable planning; `plan: false` is the obvious
/// guess, so accept it instead of failing with a type error.
fn nullable_or_false<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Toggle<T> {
        Off(bool),
        On(T),
    }
    match Option::<Toggle<T>>::deserialize(deserializer)? {
        None => Ok(Some(T::default())),
        Some(Toggle::Off(false)) => Ok(None),
        Some(Toggle::Off(true)) => Ok(Some(T::default())),
        Some(Toggle::On(value)) => Ok(Some(value)),
    }
}

#[derive(Debug, Default, Deserialize)]
struct RawWorkflow {
    version: Option<u64>,
    name: Option<String>,
    description: Option<String>,
    #[serde(default, deserialize_with = "nullable_or_false")]
    plan: Option<RawStage>,
    #[serde(default, deserialize_with = "nullable")]
    implement: Option<RawStage>,
    #[serde(default, deserialize_with = "nullable")]
    review: Option<RawReview>,
    #[serde(default, deserialize_with = "nullable")]
    fix: Option<RawStage>,
}

#[derive(Debug, Default, Deserialize)]
struct RawStage {
    agent: Option<String>,
    model: Option<String>,
    prompt: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawReview {
    max_rounds: Option<u32>,
    on_limit: Option<String>,
    reask: Option<String>,
    context: Option<Vec<String>>,
    reviewers: Option<Vec<RawReviewer>>,
}

#[derive(Debug, Default, Deserialize)]
struct RawReviewer {
    agent: Option<String>,
    model: Option<String>,
    focus: Option<String>,
    prompt: Option<String>,
}

// ─── Parsing and validation ──────────────────────────────────────────────────

/// Parse and validate one workflow file. Returns the spec (or a human-readable
/// error making the file invalid) plus non-fatal warnings either way.
pub fn parse_workflow(id: &str, yaml: &str) -> (Result<WorkflowSpec, String>, Vec<String>) {
    let mut warnings = Vec::new();
    let value: serde_yaml::Value = match serde_yaml::from_str(yaml) {
        Ok(value) => value,
        Err(e) => return (Err(format!("invalid YAML: {e}")), warnings),
    };
    if !value.is_mapping() {
        return (
            Err("workflow file must be a YAML mapping".to_string()),
            warnings,
        );
    }
    collect_unknown_keys(&value, &mut warnings);
    // Deserialize from the source text, not the `Value` above: only `from_str`
    // reports the offending key path plus line and column, and that message is
    // what the picker shows as the reason a workflow is rejected.
    let raw: RawWorkflow = match serde_yaml::from_str(yaml) {
        Ok(raw) => raw,
        Err(e) => return (Err(format!("invalid workflow: {e}")), warnings),
    };
    (build_spec(id, raw, &mut warnings), warnings)
}

/// Unknown keys are forward-compatible warnings, not errors — `workflow.list`
/// surfaces them in picker tooltips.
fn collect_unknown_keys(value: &serde_yaml::Value, warnings: &mut Vec<String>) {
    const TOP: &[&str] = &[
        "version",
        "name",
        "description",
        "plan",
        "implement",
        "review",
        "fix",
    ];
    const STAGE: &[&str] = &["agent", "model", "prompt"];
    const REVIEW: &[&str] = &["max_rounds", "on_limit", "reask", "context", "reviewers"];
    const REVIEWER: &[&str] = &["agent", "model", "focus", "prompt"];

    check_keys(value, TOP, "top level", warnings);
    for stage in ["plan", "implement", "fix"] {
        if let Some(v) = value.get(stage) {
            check_keys(v, STAGE, stage, warnings);
        }
    }
    if let Some(review) = value.get("review") {
        check_keys(review, REVIEW, "review", warnings);
        if let Some(serde_yaml::Value::Sequence(reviewers)) = review.get("reviewers") {
            for (i, reviewer) in reviewers.iter().enumerate() {
                check_keys(
                    reviewer,
                    REVIEWER,
                    &format!("review.reviewers[{i}]"),
                    warnings,
                );
            }
        }
    }
}

fn check_keys(
    value: &serde_yaml::Value,
    known: &[&str],
    location: &str,
    warnings: &mut Vec<String>,
) {
    let serde_yaml::Value::Mapping(map) = value else {
        return;
    };
    for key in map.keys() {
        if let Some(key) = key.as_str() {
            if !known.contains(&key) {
                warnings.push(format!("unknown key `{key}` in {location}"));
            }
        }
    }
}

fn build_spec(
    id: &str,
    raw: RawWorkflow,
    warnings: &mut Vec<String>,
) -> Result<WorkflowSpec, String> {
    let version = raw.version.unwrap_or(SUPPORTED_VERSION);
    if version != SUPPORTED_VERSION {
        return Err(format!(
            "unsupported workflow version {version} (this build supports {SUPPORTED_VERSION})"
        ));
    }
    let name = raw.name.as_deref().map(str::trim).unwrap_or_default();
    if name.is_empty() {
        return Err("`name` is required".to_string());
    }

    let plan = raw.plan.map(stage_config);
    let implement = raw.implement.map(stage_config).unwrap_or_default();
    let fix = raw.fix.map(stage_config).unwrap_or_default();
    let review = build_review(raw.review.unwrap_or_default(), warnings)?;

    // A placeholder this workflow can never populate renders as an empty
    // section, so scope the allow-lists: `{{plan}}` needs a plan stage and
    // `{{focus}}` needs that reviewer to define one.
    let has_plan = plan.is_some();
    let allow = |vars: &[&'static str], _focus: bool| -> Vec<&'static str> {
        vars.iter()
            .copied()
            .filter(|name| match *name {
                "plan" => has_plan,
                _ => true,
            })
            .collect()
    };
    validate_prompt(
        plan.as_ref().and_then(|s| s.prompt.as_deref()),
        "plan",
        &allow(VARS_PLAN, false),
    )?;
    validate_prompt(
        implement.prompt.as_deref(),
        "implement",
        &allow(VARS_IMPLEMENT, false),
    )?;
    validate_prompt(fix.prompt.as_deref(), "fix", &allow(VARS_FIX, false))?;
    for (i, reviewer) in review.reviewers.iter().enumerate() {
        validate_prompt(
            reviewer.prompt.as_deref(),
            &format!("review.reviewers[{i}]"),
            &allow(VARS_REVIEW, reviewer.focus.is_some()),
        )?;
    }
    // `context` and `focus` only shape the BUILT-IN reviewer prompt: a custom
    // prompt renders its own context. Silently ignoring them is the most
    // confusing possible outcome for the first edit a user makes.
    if review.reviewers.iter().all(|r| r.prompt.is_some()) {
        if review.context_was_set {
            warnings.push(
                "review.context is ignored because every reviewer defines its own `prompt` — a \
                 custom prompt decides what context it includes"
                    .to_string(),
            );
        }
        for (i, reviewer) in review.reviewers.iter().enumerate() {
            let uses_focus = reviewer
                .prompt
                .as_deref()
                .is_some_and(|p| extract_placeholders(p).iter().any(|v| v == "focus"));
            if reviewer.focus.is_some() && !uses_focus {
                warnings.push(format!(
                    "review.reviewers[{i}].focus is ignored because that reviewer's `prompt` \
                     never uses {{{{focus}}}}"
                ));
            }
        }
    }

    Ok(WorkflowSpec {
        id: id.to_string(),
        name: name.to_string(),
        description: raw
            .description
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty()),
        plan,
        implement,
        review,
        fix,
    })
}

fn stage_config(raw: RawStage) -> StageConfig {
    StageConfig {
        agent: raw.agent,
        model: raw.model,
        prompt: raw.prompt,
    }
}

fn build_review(raw: RawReview, warnings: &mut Vec<String>) -> Result<ReviewConfig, String> {
    let context_was_set = raw.context.is_some();
    let mut max_rounds = raw.max_rounds.unwrap_or(DEFAULT_MAX_ROUNDS);
    if max_rounds == 0 {
        return Err("review.max_rounds must be at least 1".to_string());
    }
    if max_rounds > MAX_ROUNDS_CAP {
        warnings.push(format!(
            "review.max_rounds {max_rounds} exceeds the cap, clamped to {MAX_ROUNDS_CAP}"
        ));
        max_rounds = MAX_ROUNDS_CAP;
    }

    let reask = match raw.reask.as_deref() {
        None => ReaskMode::default(),
        Some("same_session") => ReaskMode::SameSession,
        Some("fresh") => ReaskMode::Fresh,
        Some(other) => {
            return Err(format!(
                "review.reask must be `same_session` or `fresh`, got `{other}`"
            ))
        }
    };

    let on_limit = match raw.on_limit.as_deref() {
        None => OnLimit::Ask,
        Some("ask") => OnLimit::Ask,
        Some("finish") => OnLimit::Finish,
        Some(other) => {
            return Err(format!(
                "review.on_limit must be `ask` or `finish`, got `{other}`"
            ))
        }
    };

    let context = match raw.context {
        None => vec![
            ReviewContextItem::Prompt,
            ReviewContextItem::Plan,
            ReviewContextItem::ImplementerSummary,
            ReviewContextItem::Diff,
        ],
        Some(items) => {
            if items.is_empty() {
                warnings.push(
                    "review.context is empty — reviewers will only see their instructions"
                        .to_string(),
                );
            }
            let mut parsed = Vec::with_capacity(items.len());
            for item in &items {
                parsed.push(match item.as_str() {
                    "prompt" => ReviewContextItem::Prompt,
                    "plan" => ReviewContextItem::Plan,
                    "implementer_summary" => ReviewContextItem::ImplementerSummary,
                    "diff" => ReviewContextItem::Diff,
                    other => {
                        return Err(format!(
                            "unknown review.context item `{other}` (expected prompt, plan, implementer_summary, diff)"
                        ))
                    }
                });
            }
            parsed
        }
    };

    let reviewers = match raw.reviewers {
        None => vec![ReviewerConfig::default()],
        Some(list) => {
            if list.is_empty() || list.len() > MAX_REVIEWERS {
                return Err(format!(
                    "review.reviewers must list 1..{MAX_REVIEWERS} reviewers when set, got {}",
                    list.len()
                ));
            }
            list.into_iter()
                .map(|r| ReviewerConfig {
                    agent: r.agent,
                    model: r.model,
                    focus: r.focus,
                    prompt: r.prompt,
                })
                .collect()
        }
    };

    Ok(ReviewConfig {
        max_rounds,
        on_limit,
        reask,
        context,
        reviewers,
        context_was_set,
    })
}
