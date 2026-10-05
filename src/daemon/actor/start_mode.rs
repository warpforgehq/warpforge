use std::collections::HashMap;

use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;

impl Daemon {
    /// Starts a fresh Claude task in its `auto` permission mode rather than
    /// the agent's own `default` ("Manual"), unless the caller picked a mode.
    /// @param agent the agent the task runs on
    /// @param overrides the selectors the caller asked for
    /// @returns the overrides, with `auto` added when it applies
    pub(crate) fn with_default_mode(
        &self,
        agent: &str,
        mut overrides: HashMap<String, String>,
    ) -> HashMap<String, String> {
        if self.agent_id_of(agent) != "claude" {
            return overrides;
        }
        let options = self
            .configured_agents
            .iter()
            .find(|candidate| candidate.id == "claude")
            .map(|candidate| candidate.models.as_slice())
            .unwrap_or_default();
        if let Some((id, value)) = auto_mode(options) {
            overrides.entry(id).or_insert(value);
        }
        overrides
    }
}

/// The `auto` choice of the agent's mode selector, when it advertises one.
/// @param options the selectors the agent reported
/// @returns the config id and value to set, if any fits
fn auto_mode(options: &[wire::ConfigOption]) -> Option<(String, String)> {
    let mode = options
        .iter()
        .find(|o| o.category.as_deref() == Some("mode") || o.id == "mode")?;
    mode.options
        .iter()
        .find(|choice| choice.value == "auto")
        .map(|choice| (mode.id.clone(), choice.value.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode(values: &[&str]) -> wire::ConfigOption {
        wire::ConfigOption {
            id: "mode".into(),
            name: "Mode".into(),
            category: Some("mode".into()),
            current_value: values[0].into(),
            options: values
                .iter()
                .map(|v| wire::ConfigChoice {
                    value: (*v).into(),
                    name: (*v).into(),
                })
                .collect(),
        }
    }

    #[test]
    fn auto_is_picked_only_when_the_agent_advertises_it() {
        let claude = [mode(&["default", "acceptEdits", "plan", "auto"])];
        assert_eq!(auto_mode(&claude), Some(("mode".into(), "auto".into())));
        assert_eq!(auto_mode(&[mode(&["default", "plan"])]), None);
        assert_eq!(auto_mode(&[]), None);
    }
}
