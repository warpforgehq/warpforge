use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

mod load;
pub(crate) use load::{
    find_config_file, load_local, load_shared, read_config_text, resolve_config_path,
    validate_worktree, CONFIG_NAMES,
};
pub use load::{load_workspace_config, try_load_workspace_config};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealthcheck {
    pub url: String,
    #[serde(default)]
    pub interval: Option<String>,
}

/// Explicit override for how a service reacts when its configured `port` is
/// taken. `auto` opts back into first-free-in-range shifting; `None` means
/// "infer": strict when the port is pinned, auto otherwise. (The ADR only
/// ever specifies `auto` as the opt-out — a `strict` value would be a no-op,
/// so it is not expressible.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PortFallback {
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub command: String,
    pub port: Option<u16>,
    pub env: Option<HashMap<String, String>>,
    pub healthcheck: Option<ServiceHealthcheck>,
    #[serde(rename = "readyPattern")]
    pub ready_pattern: Option<String>,
    #[serde(rename = "readyTimeout", default)]
    pub ready_timeout: Option<String>,
    /// Services that must be running before this one starts
    #[serde(rename = "dependsOn", default)]
    pub depends_on: Vec<String>,
    #[serde(rename = "portFallback", default)]
    pub port_fallback: Option<PortFallback>,
}

/// Project-level committed port range, e.g. `range: "4200-4299"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortsConfig {
    /// Inclusive range string, e.g. "4200-4299".
    pub range: String,
}

/// One kubectl port-forward entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardConfig {
    pub namespace: String,
    /// Pod name or prefix (warpforge finds first matching pod)
    pub pod: String,
    #[serde(rename = "localPort")]
    pub local_port: u16,
    #[serde(rename = "remotePort")]
    pub remote_port: u16,
    /// Human-readable label shown in TUI
    pub name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked: Vec<std::path::PathBuf>,
    #[serde(default)]
    pub services: HashMap<String, ServiceConfig>,
    #[serde(default)]
    pub portforwards: Vec<PortForwardConfig>,
    #[serde(default)]
    pub ports: Option<PortsConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<crate::worktree_config::WorktreeConfig>,
    /// What the local override file changed; empty when there is none.
    #[serde(skip)]
    pub local: crate::config_local::LocalOverrides,
    /// Why the local override file is being ignored, when it is.
    #[serde(skip)]
    pub local_error: Option<String>,
}

/// Topologically sorted service names respecting `depends_on`.
/// Dependencies start first. Falls back to alphabetical on cycles.
pub fn sorted_services(config: &WorkspaceConfig) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();

    fn visit(
        name: &str,
        config: &WorkspaceConfig,
        visited: &mut std::collections::HashSet<String>,
        result: &mut Vec<String>,
        depth: usize,
    ) {
        if visited.contains(name) || depth > 20 {
            return;
        }
        visited.insert(name.to_string());
        if let Some(svc) = config.services.get(name) {
            for dep in &svc.depends_on {
                visit(dep, config, visited, result, depth + 1);
            }
        }
        if config.services.contains_key(name) {
            result.push(name.to_string());
        }
    }

    let mut names: Vec<String> = config.services.keys().cloned().collect();
    names.sort();
    for name in &names {
        visit(name, config, &mut visited, &mut result, 0);
    }
    result
}

fn auto_detect(project_path: &Path) -> Option<WorkspaceConfig> {
    let mut services = HashMap::new();
    // Detect package.json dev script
    let pkg_path = project_path.join("package.json");
    if pkg_path.exists() {
        if let Ok(text) = fs::read_to_string(&pkg_path) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&text) {
                if pkg["scripts"]["dev"].is_string() {
                    let is_bun = project_path.join("bun.lock").exists()
                        || project_path.join("bunfig.toml").exists();
                    services.insert(
                        "app".to_string(),
                        ServiceConfig {
                            command: if is_bun { "bun run dev" } else { "npm run dev" }.to_string(),
                            port: Some(3000),
                            env: None,
                            healthcheck: None,
                            ready_pattern: None,
                            ready_timeout: None,
                            depends_on: vec![],
                            port_fallback: None,
                        },
                    );
                }
            }
        }
    }

    // Detect docker-compose
    let compose_names = [
        "docker-compose.yaml",
        "docker-compose.yml",
        "compose.yaml",
        "compose.yml",
    ];
    'compose: for compose_name in &compose_names {
        let compose_path = project_path.join(compose_name);
        if compose_path.exists() {
            if let Ok(text) = fs::read_to_string(&compose_path) {
                if let Ok(compose) = serde_yaml::from_str::<serde_yaml::Value>(&text) {
                    if let Some(svcs) = compose["services"].as_mapping() {
                        for (k, v) in svcs {
                            let svc_name = k.as_str().unwrap_or_default().to_string();
                            if let Some(ports) = v["ports"].as_sequence() {
                                if let Some(port_str) = ports.first().and_then(|p| p.as_str()) {
                                    if let Ok(port) = port_str
                                        .split(':')
                                        .next_back()
                                        .unwrap_or("0")
                                        .parse::<u16>()
                                    {
                                        if port > 0 {
                                            services.insert(
                                                svc_name.clone(),
                                                ServiceConfig {
                                                    command: format!(
                                                        "docker compose up {svc_name}"
                                                    ),
                                                    port: Some(port),
                                                    env: None,
                                                    healthcheck: None,
                                                    ready_pattern: None,
                                                    ready_timeout: None,
                                                    depends_on: vec![],
                                                    port_fallback: None,
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            break 'compose;
        }
    }

    if services.is_empty() {
        return None;
    }

    Some(WorkspaceConfig {
        name: None,
        services,
        portforwards: vec![],
        ports: None,
        worktree: None,
        linked: Vec::new(),
        local: Default::default(),
        local_error: None,
    })
}

/// Generate a `.warpforge/workspace.yaml` file in the given directory.
/// If auto-detection finds services, pre-populates them. Refuses to run when
/// any config (new or legacy location) already exists.
pub fn generate_workspace_yaml(project_path: &Path) -> anyhow::Result<()> {
    for name in CONFIG_NAMES {
        let existing = project_path.join(name);
        if load::config_present(&existing) {
            anyhow::bail!("config already exists at {}", existing.display());
        }
    }
    let target = project_path.join(CONFIG_NAMES[0]);

    let name = project_path
        .canonicalize()
        .unwrap_or_else(|_| project_path.to_path_buf())
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let content = if let Some(mut config) = auto_detect(project_path) {
        config.name = Some(name);
        // Serialize detected config
        let yaml = serde_yaml::to_string(&config)?;
        format!("# .warpforge/workspace.yaml — auto-detected by warpforge\n{yaml}")
    } else {
        // Write template
        format!(
            r#"# .warpforge/workspace.yaml — Warpforge project configuration
name: {name}

services:
  app:
    command: npm run dev
    port: 3000
    # env:
    #   DATABASE_URL: postgres://localhost:${{db.port}}/mydb
    # healthcheck:
    #   url: http://localhost:${{app.port}}/api/health
    #   interval: 5s

"#
        )
    };

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    fs::write(&target, content)?;
    println!("Created {}", target.display());
    Ok(())
}

/// Parse an inclusive range string: `"4200-4299"`, or a bare `"4200"`
/// meaning start with the default range size (100).
/// Rejects inverted/zero-width ranges and privileged starts (< 1024).
pub fn parse_range(s: &str) -> Option<(u16, u16)> {
    const DEFAULT_RANGE_SIZE: u16 = 100;
    let (start_str, end) = match s.split_once('-') {
        Some((start, end)) => (start, end.parse::<u16>().ok()?),
        None => (
            s,
            s.parse::<u16>().ok()?.checked_add(DEFAULT_RANGE_SIZE - 1)?,
        ),
    };
    let start = start_str.parse::<u16>().ok()?;
    if start < 1024 || end <= start {
        return None;
    }
    Some((start, end))
}

/// Parse a duration string ("100ms", "5s", "2m" or "2min", "1h"). `None` for
/// anything unparseable or zero.
pub fn parse_duration(value: &str) -> Option<std::time::Duration> {
    let value = value.trim();
    let (num, scale) = if let Some(n) = value.strip_suffix("ms") {
        (n, 1)
    } else if let Some(n) = value.strip_suffix('s') {
        (n, 1000)
    } else if let Some(n) = value.strip_suffix('h') {
        (n, 3_600_000)
    } else if let Some(n) = value.strip_suffix("min") {
        (n, 60_000)
    } else {
        (value.strip_suffix('m')?, 60_000)
    };
    let ms = num.trim().parse::<u64>().ok()?.checked_mul(scale)?;
    (ms > 0).then(|| std::time::Duration::from_millis(ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_accepts_explicit_range() {
        assert_eq!(parse_range("4200-4299"), Some((4200, 4299)));
    }

    #[test]
    fn parse_range_accepts_bare_start_with_default_size() {
        assert_eq!(parse_range("4200"), Some((4200, 4299)));
    }

    #[test]
    fn parse_range_rejects_inverted_range() {
        assert_eq!(parse_range("4299-4200"), None);
    }

    #[test]
    fn parse_range_rejects_zero_width_range() {
        assert_eq!(parse_range("4200-4200"), None);
    }

    #[test]
    fn parse_range_rejects_privileged_start() {
        assert_eq!(parse_range("80-179"), None);
        assert_eq!(parse_range("80"), None);
        assert_eq!(parse_range("1023-1100"), None);
    }

    #[test]
    fn parse_range_accepts_lowest_legal_start() {
        assert_eq!(parse_range("1024-1123"), Some((1024, 1123)));
    }

    #[test]
    fn parse_range_rejects_garbage() {
        assert_eq!(parse_range(""), None);
        assert_eq!(parse_range("abc"), None);
        assert_eq!(parse_range("4200-"), None);
        assert_eq!(parse_range("70000"), None);
    }

    #[test]
    fn parse_range_rejects_start_that_overflows_default_size() {
        assert_eq!(parse_range("65500"), None);
        assert_eq!(parse_range("65535"), None);
    }
}
