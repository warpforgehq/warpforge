use serde_json::Value;
use warpforge_protocol as wire;

/// Whether a config option is the model selector. The heuristic mirrors
/// AgentConfigBar.tsx: the first option whose lowercased
/// category/id/name contains "model". CAUTION: `model_config` is a real
/// category of on/off toggles (claude's `{id: "fast", name: "Fast mode"}`),
/// so an option whose *category* is exactly `model_config` is never the
/// selector even though its identity string contains "model".
pub(crate) fn is_model_selector(o: &wire::ConfigOption) -> bool {
    if o.category.as_deref().map(|c| c.to_lowercase()).as_deref() == Some("model_config") {
        return false;
    }
    let identity = format!(
        "{} {} {}",
        o.category.as_deref().unwrap_or(""),
        o.id,
        o.name
    )
    .to_lowercase();
    identity.contains("model")
}

/// What the session driver should do with a task's model intent at session
/// start (fresh or resume).
pub(super) enum ModelApply {
    /// No explicit intent, or the session is already on the requested model.
    /// Behaviour is exactly the pre-intent one: fresh keeps the agent default,
    /// resume keeps the loaded session's model state.
    Keep,
    /// Intent exists but no known selector looks like a model picker. Log
    /// only — some harnesses announce selectors later via a
    /// `config_option_update` instead of the session/new or session/load
    /// reply, so an absent selector is not proof of a mismatch and flagging
    /// it would be a false alarm that never clears.
    UnknownSelector,
    /// Set this config option to this value.
    Set { config_id: String, value: String },
}

pub(super) fn resolve_model_apply(
    intent: Option<&str>,
    options: &[wire::ConfigOption],
) -> ModelApply {
    let Some(value) = intent else {
        return ModelApply::Keep;
    };
    match options.iter().find(|o| is_model_selector(o)) {
        Some(opt) if opt.current_value != value => ModelApply::Set {
            config_id: opt.id.clone(),
            value: value.to_string(),
        },
        Some(_) => ModelApply::Keep,
        None => ModelApply::UnknownSelector,
    }
}

/// Parse an ACP `configOptions` array (model/mode/reasoning selectors).
pub fn parse_config_options(v: Option<&Value>) -> Vec<wire::ConfigOption> {
    let Some(arr) = v.and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|o| {
            Some(wire::ConfigOption {
                id: o.get("id")?.as_str()?.to_string(),
                name: o
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                category: o.get("category").and_then(|x| x.as_str()).map(String::from),
                current_value: o
                    .get("currentValue")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                options: o
                    .get("options")
                    .and_then(|x| x.as_array())
                    .map(|opts| {
                        opts.iter()
                            .filter_map(|c| {
                                Some(wire::ConfigChoice {
                                    value: c.get("value")?.as_str()?.to_string(),
                                    name: c
                                        .get("name")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}
