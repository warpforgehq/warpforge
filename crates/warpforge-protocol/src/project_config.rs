use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConfigScope {
    Shared,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProjectConfigWrite {
    pub project: String,
    pub scope: ConfigScope,
    pub text: String,
    #[serde(deserialize_with = "Deserialize::deserialize")]
    pub base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigError {
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigFile {
    pub path: String,
    pub exists: bool,
    pub text: String,
    pub fingerprint: Option<String>,
}

#[cfg(test)]
mod tests {
    use crate::*;

    #[test]
    fn config_write_requires_base_and_derives_its_own_path() {
        let request = serde_json::json!({
            "method": "project.config.write",
            "params": { "project": "demo", "scope": "local", "text": "{}", "base": null }
        });
        assert!(matches!(
            serde_json::from_value::<Method>(request.clone()).unwrap(),
            Method::ProjectConfigWrite(ProjectConfigWrite { base: None, .. })
        ));
        let mut missing_base = request.clone();
        missing_base["params"]
            .as_object_mut()
            .unwrap()
            .remove("base");
        assert!(serde_json::from_value::<Method>(missing_base).is_err());
        let mut supplied_path = request;
        supplied_path["params"]["path"] = serde_json::json!("untrusted.yaml");
        assert!(serde_json::from_value::<Method>(supplied_path).is_err());
    }

    #[test]
    fn project_config_changed_event_roundtrip() {
        let ev = Event::ProjectConfigChanged(ProjectConfigState {
            project: ProjectInfo {
                name: "demo".into(),
                path: "/tmp/demo".into(),
                port_range: (4000, 4099),
                port_range_source: PortRangeSource::Auto,
                port_range_conflict: None,
                declared_services: vec!["web".into()],
                local_config_error: None,
                config_error: None,
                linked: Vec::new(),
            },
            services: vec![ServiceInfo {
                project: "demo".into(),
                name: "web".into(),
                command: "npm run dev".into(),
                status: ServiceStatus::Stopped,
                original_port: 3000,
                allocated_port: 0,
                checkout: "/tmp/demo".into(),
                port_pinned: false,
                port_warning: None,
                log_seq: 0,
                local: false,
                local_fields: Vec::new(),
                needs_restart: false,
            }],
            portforwards: Vec::new(),
        });

        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains(r#""event":"project.configChanged""#));
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ev);
    }
}
