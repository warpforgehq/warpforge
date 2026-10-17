//! What a new Smith starts from (ADR 0027): the soul and charter templates and
//! the voice presets a client offers, served by `smiths.defaults` so the
//! client never invents template text of its own.

use warpforge_protocol as wire;

use super::{soul_template, CHARTER_TEMPLATE};

/// Shown in the soul when the client has no name yet.
const PLACEHOLDER_NAME: &str = "Smith";

/// `(id, label, description, voice)`. The first is the template's own voice.
const PRESETS: [(&str, &str, &str, &str); 4] = [
    (
        "plain",
        "Plain",
        "Short, direct answers, no flourish.",
        "Plain and direct.",
    ),
    (
        "careful",
        "Careful",
        "Checks twice, explains its reasoning, asks when unsure.",
        "Careful and thorough. States what it checked and why, and asks before \
         guessing.",
    ),
    (
        "fast",
        "Fast",
        "Gets to a working result quickly, keeps updates brief.",
        "Quick and pragmatic. Ships the smallest change that works and reports in \
         a line or two.",
    ),
    (
        "reviewer",
        "Reviewer",
        "Reads changes critically and names risks first.",
        "Critical and precise. Leads with risks and missing tests, then smaller \
         notes, each with a concrete fix.",
    ),
];

/// @param name the name to put in the soul, if the client has one
/// @returns the templates and the presets
pub fn defaults(name: Option<&str>) -> wire::SmithDefaults {
    let name = name.map(str::trim).filter(|n| !n.is_empty());
    wire::SmithDefaults {
        soul: soul_template(name.unwrap_or(PLACEHOLDER_NAME)),
        charter: CHARTER_TEMPLATE.to_string(),
        presets: PRESETS
            .iter()
            .map(|(id, label, description, voice)| wire::SmithPreset {
                id: (*id).into(),
                label: (*label).into(),
                description: (*description).into(),
                voice: (*voice).into(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_preset_is_the_templates_own_voice() {
        let defaults = defaults(Some("Ada"));
        let voice = &defaults.presets[0].voice;
        assert!(
            defaults.soul.contains(&format!("## Voice\n\n{voice}\n")),
            "{}",
            defaults.soul
        );
        assert!(defaults.soul.starts_with("# Ada\n"));
        assert_eq!(defaults.charter, CHARTER_TEMPLATE);
    }

    #[test]
    fn a_missing_name_gets_a_placeholder_and_every_preset_has_a_voice() {
        assert!(defaults(Some("  ")).soul.starts_with("# Smith\n"));
        let presets = defaults(None).presets;
        assert_eq!(presets.len(), 4);
        assert!(presets
            .iter()
            .all(|p| !p.voice.is_empty() && !p.voice.contains('\n')));
    }

    #[test]
    fn the_method_parses_with_or_without_a_name() {
        for params in [serde_json::json!({}), serde_json::json!({ "name": "Ada" })] {
            let method: wire::Method = serde_json::from_value(serde_json::json!({
                "method": "smiths.defaults",
                "params": params,
            }))
            .unwrap();
            assert!(matches!(method, wire::Method::SmithsDefaults { .. }));
        }
    }
}
