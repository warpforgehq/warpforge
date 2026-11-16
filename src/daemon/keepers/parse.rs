use serde::Deserialize;
use serde_yaml::Value;
use warpforge_protocol as wire;

use super::presets::{preset, preset_ids, PREAMBLE};
use super::{
    DEFAULT_MAX_ROUNDS, DEFAULT_TIME_LIMIT_SECS, MAX_ROUNDS_CAP, PROMPT_VARS, SUPPORTED_VERSION,
    TIME_LIMIT_CAP_SECS,
};
use crate::workflow_config::extract_placeholders;

const KEYS: &[&str] = &[
    "version",
    "name",
    "description",
    "preset",
    "when",
    "result",
    "agent",
    "model",
    "effort",
    "time_limit",
    "max_rounds",
    "min_severity",
    "default",
    "paths",
    "instructions",
    "prompt",
];

#[derive(Debug, Default, Deserialize)]
struct RawKeeper {
    version: Option<u64>,
    name: Option<String>,
    description: Option<String>,
    preset: Option<String>,
    when: Option<String>,
    result: Option<String>,
    agent: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    time_limit: Option<Value>,
    max_rounds: Option<u32>,
    min_severity: Option<String>,
    default: Option<Value>,
    paths: Option<Vec<String>>,
    instructions: Option<String>,
    prompt: Option<String>,
}

impl RawKeeper {
    /// The file's values where it sets them, the preset's elsewhere.
    fn over(self, base: RawKeeper) -> RawKeeper {
        RawKeeper {
            version: self.version,
            name: self.name.or(base.name),
            description: self.description.or(base.description),
            preset: self.preset,
            when: self.when.or(base.when),
            result: self.result.or(base.result),
            agent: self.agent.or(base.agent),
            model: self.model.or(base.model),
            effort: self.effort.or(base.effort),
            time_limit: self.time_limit.or(base.time_limit),
            max_rounds: self.max_rounds.or(base.max_rounds),
            min_severity: self.min_severity.or(base.min_severity),
            default: self.default.or(base.default),
            paths: self.paths.or(base.paths),
            instructions: self.instructions,
            prompt: self.prompt.or(base.prompt),
        }
    }
}

/// Parse and validate one keeper file, applying its preset.
/// @param id the file stem
/// @param yaml the file's text
/// @returns the definition or why the file is invalid, and non-fatal warnings
pub fn parse_keeper(id: &str, yaml: &str) -> (Result<wire::KeeperDefinition, String>, Vec<String>) {
    let mut warnings = Vec::new();
    let result = read_raw(yaml, &mut warnings).and_then(|raw| build(id, raw, &mut warnings));
    (result, warnings)
}

fn read_raw(yaml: &str, warnings: &mut Vec<String>) -> Result<RawKeeper, String> {
    let value: Value = serde_yaml::from_str(yaml).map_err(|e| format!("invalid YAML: {e}"))?;
    let Value::Mapping(map) = &value else {
        return Err("keeper file must be a YAML mapping".to_string());
    };
    for key in map.keys().filter_map(Value::as_str) {
        if !KEYS.contains(&key) {
            warnings.push(format!("unknown key `{key}`"));
        }
    }
    serde_yaml::from_value(value).map_err(|e| format!("invalid keeper: {e}"))
}

fn build(
    id: &str,
    raw: RawKeeper,
    warnings: &mut Vec<String>,
) -> Result<wire::KeeperDefinition, String> {
    let version = raw.version.unwrap_or(SUPPORTED_VERSION);
    if version != SUPPORTED_VERSION {
        return Err(format!(
            "unsupported keeper version {version} (this build supports {SUPPORTED_VERSION})"
        ));
    }
    let preset_id = text(raw.preset.clone());
    let raw = match &preset_id {
        None => raw,
        Some(preset_id) => {
            let Some(yaml) = preset(preset_id) else {
                return Err(format!(
                    "unknown preset `{preset_id}` (built-in: {})",
                    preset_ids()
                ));
            };
            let base: RawKeeper = serde_yaml::from_str(yaml)
                .map_err(|e| format!("built-in preset `{preset_id}`: {e}"))?;
            raw.over(base)
        }
    };
    let name = text(raw.name).ok_or("`name` is required")?;

    let body = match (text(raw.prompt), text(raw.instructions)) {
        (Some(prompt), Some(instructions)) => format!("{prompt}\n\n{instructions}"),
        (Some(body), None) | (None, Some(body)) => body,
        (None, None) => return Err("a keeper needs `prompt`, `instructions` or a `preset`".into()),
    };
    let prompt = format!("{}\n\n{body}\n", PREAMBLE.trim_end());
    if let Some(name) = extract_placeholders(&prompt)
        .into_iter()
        .find(|name| !PROMPT_VARS.contains(&name.as_str()))
    {
        return Err(format!(
            "unknown placeholder {{{{{name}}}}} in prompt (allowed: {})",
            PROMPT_VARS.join(", ")
        ));
    }

    let when = choice(
        raw.when,
        "when",
        &[
            ("commit", wire::KeeperWhen::Commit),
            ("ready", wire::KeeperWhen::Ready),
            ("ci", wire::KeeperWhen::Ci),
            ("comments", wire::KeeperWhen::Comments),
        ],
    )?;
    if matches!(when, wire::KeeperWhen::Ci | wire::KeeperWhen::Comments) {
        warnings.push(
            "`when: ci` and `when: comments` are not run yet; this keeper stays idle until \
post-PR keepers ship"
                .to_string(),
        );
    }
    Ok(wire::KeeperDefinition {
        id: id.to_string(),
        name,
        description: text(raw.description),
        preset: preset_id,
        when,
        result: choice(
            raw.result,
            "result",
            &[
                ("findings", wire::KeeperResultKind::Findings),
                ("pass_fail", wire::KeeperResultKind::PassFail),
                ("verdict", wire::KeeperResultKind::Verdict),
                ("draft", wire::KeeperResultKind::Draft),
            ],
        )?,
        agent: text(raw.agent),
        model: text(raw.model),
        effort: text(raw.effort),
        time_limit_secs: time_limit(raw.time_limit, warnings)?,
        max_rounds: max_rounds(raw.max_rounds, warnings)?,
        min_severity: choice(
            raw.min_severity,
            "min_severity",
            &[
                ("critical", wire::KeeperSeverity::Critical),
                ("high", wire::KeeperSeverity::High),
                ("medium", wire::KeeperSeverity::Medium),
                ("low", wire::KeeperSeverity::Low),
            ],
        )?,
        default_on: default_on(raw.default)?,
        paths: paths(raw.paths)?,
        prompt,
    })
}

fn text(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn choice<T: Copy + Default>(
    value: Option<String>,
    key: &str,
    options: &[(&str, T)],
) -> Result<T, String> {
    let Some(value) = text(value) else {
        return Ok(T::default());
    };
    options
        .iter()
        .find(|(name, _)| *name == value)
        .map(|(_, option)| *option)
        .ok_or_else(|| {
            let names: Vec<&str> = options.iter().map(|(name, _)| *name).collect();
            format!("`{key}` must be one of {}, got `{value}`", names.join(", "))
        })
}

fn time_limit(value: Option<Value>, warnings: &mut Vec<String>) -> Result<u64, String> {
    let Some(value) = value else {
        return Ok(DEFAULT_TIME_LIMIT_SECS);
    };
    let secs = value
        .as_str()
        .and_then(crate::config::parse_duration)
        .map(|limit| limit.as_secs())
        .filter(|secs| *secs > 0)
        .ok_or("`time_limit` must be a duration such as `15m`")?;
    if secs > TIME_LIMIT_CAP_SECS {
        warnings.push(format!(
            "time_limit exceeds the cap, clamped to {}m",
            TIME_LIMIT_CAP_SECS / 60
        ));
        return Ok(TIME_LIMIT_CAP_SECS);
    }
    Ok(secs)
}

fn max_rounds(value: Option<u32>, warnings: &mut Vec<String>) -> Result<u32, String> {
    match value.unwrap_or(DEFAULT_MAX_ROUNDS) {
        0 => Err("`max_rounds` must be at least 1".to_string()),
        rounds if rounds > MAX_ROUNDS_CAP => {
            warnings.push(format!(
                "max_rounds {rounds} exceeds the cap, clamped to {MAX_ROUNDS_CAP}"
            ));
            Ok(MAX_ROUNDS_CAP)
        }
        rounds => Ok(rounds),
    }
}

/// YAML 1.2 reads a bare `on` as a string, so both spellings are accepted.
fn default_on(value: Option<Value>) -> Result<bool, String> {
    match value {
        None => Ok(true),
        Some(Value::Bool(on)) => Ok(on),
        Some(Value::String(word)) if word == "on" => Ok(true),
        Some(Value::String(word)) if word == "off" => Ok(false),
        Some(_) => Err("`default` must be `on` or `off`".to_string()),
    }
}

fn paths(value: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for path in value.unwrap_or_default() {
        let path = path.trim();
        let pattern = path.strip_prefix('!').unwrap_or(path);
        if pattern.is_empty() {
            return Err("`paths` entries must not be empty".to_string());
        }
        glob::Pattern::new(pattern).map_err(|e| format!("invalid glob `{path}` in paths: {e}"))?;
        out.push(path.to_string());
    }
    Ok(out)
}
