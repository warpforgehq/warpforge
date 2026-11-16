use warpforge_protocol as wire;

use super::parse_keeper;

/// Built-in keepers by id. A preset runs only when a project file names it
/// with `preset:` (ADR 0030 invariant 18), so nothing lists these as keepers.
pub(super) const PRESETS: &[(&str, &str)] = &[
    ("review", include_str!("../../keepers/review.yaml")),
    ("slop", include_str!("../../keepers/slop.yaml")),
    (
        "conventions",
        include_str!("../../keepers/conventions.yaml"),
    ),
    ("security", include_str!("../../keepers/security.yaml")),
    (
        "thermonuclear",
        include_str!("../../keepers/thermonuclear.yaml"),
    ),
    ("intent", include_str!("../../keepers/intent.yaml")),
    ("verify", include_str!("../../keepers/verify.yaml")),
    ("pr-ready", include_str!("../../keepers/pr-ready.yaml")),
];

/// Prepended to every keeper's prompt, a custom `prompt:` included.
pub(super) const PREAMBLE: &str = include_str!("../../keepers/preamble.md");

pub(super) fn preset(id: &str) -> Option<&'static str> {
    PRESETS
        .iter()
        .find(|(preset_id, _)| *preset_id == id)
        .map(|(_, text)| *text)
}

pub(super) fn preset_ids() -> String {
    PRESETS
        .iter()
        .map(|(id, _)| *id)
        .collect::<Vec<_>>()
        .join(", ")
}

/// The built-ins **Add keeper** offers, in menu order.
pub fn list_presets() -> Vec<wire::KeeperPreset> {
    PRESETS
        .iter()
        .map(|(id, text)| {
            let (definition, _) = parse_keeper(id, text);
            let definition = definition.expect("built-in preset parses");
            wire::KeeperPreset {
                id: definition.id,
                name: definition.name,
                description: definition.description,
                when: definition.when,
            }
        })
        .collect()
}
