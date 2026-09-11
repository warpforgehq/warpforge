use std::collections::{BTreeMap, HashMap, HashSet};

use super::{IssueSeverity, ValidationIssue};

// ── YAML Validation ───────────────────────────────────────────────────────────

pub fn validate_config_yaml(
    yaml_str: &str,
) -> Result<(crate::config::WorkspaceConfig, Vec<ValidationIssue>), String> {
    let config: crate::config::WorkspaceConfig =
        serde_yaml::from_str(yaml_str).map_err(|e| format!("YAML parse error: {e}"))?;

    let mut issues = Vec::new();
    if config.name.trim().is_empty() {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Error,
            message: "Project name is required and cannot be blank.".into(),
        });
    }
    if config.services.is_empty() {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Warning,
            message: "No services are configured.".into(),
        });
    }

    let mut portforward_names = HashSet::new();
    for (index, portforward) in config.portforwards.iter().enumerate() {
        let label = portforward
            .name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("#{}", index + 1));

        match portforward.name.as_deref().map(str::trim) {
            Some("") | None => issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                message: format!(
                    "Port-forward {label} has no name, so services cannot reference it in dependsOn."
                ),
            }),
            Some(name) if !portforward_names.insert(name.to_string()) => {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    message: format!(
                        "Port-forward name '{name}' is duplicated; every dependency target must be unambiguous."
                    ),
                });
            }
            Some(_) => {}
        }

        if portforward.namespace.trim().is_empty() {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!("Port-forward '{label}' requires a namespace."),
            });
        }
        if portforward.pod.trim().is_empty() {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!("Port-forward '{label}' requires a pod name or prefix."),
            });
        }
        if portforward.local_port == 0 {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!("Port-forward '{label}' localPort must be between 1 and 65535."),
            });
        }
        if portforward.remote_port == 0 {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!("Port-forward '{label}' remotePort must be between 1 and 65535."),
            });
        }
    }

    for (name, service) in &config.services {
        if service.command.trim().is_empty() {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!("Service '{name}' requires a non-empty command."),
            });
        }
        if service
            .ready_pattern
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
        {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                message: format!(
                    "Service '{name}' has a blank readyPattern; remove it or use a literal startup-log substring."
                ),
            });
        }
        for dependency in &service.depends_on {
            if !config.services.contains_key(dependency)
                && !portforward_names.contains(dependency.as_str())
            {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    message: format!(
                        "Service '{name}' depends on unknown target '{dependency}' (expected a service or named port-forward)."
                    ),
                });
            }
        }
    }

    for cycle in dependency_cycles(&config) {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Error,
            message: format!("Circular service dependency: {}.", cycle.join(" -> ")),
        });
    }

    let mut fixed_ports: BTreeMap<u16, Vec<String>> = BTreeMap::new();
    for (index, portforward) in config.portforwards.iter().enumerate() {
        if portforward.local_port > 0 {
            let label = portforward
                .name
                .clone()
                .unwrap_or_else(|| format!("#{}", index + 1));
            fixed_ports
                .entry(portforward.local_port)
                .or_default()
                .push(format!("port-forward '{label}'"));
        }
    }
    for (port, owners) in &fixed_ports {
        if owners.len() > 1 {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                message: format!(
                    "Fixed local port {port} is used by {}; port-forward localPort values must be unique.",
                    owners.join(" and ")
                ),
            });
        }
    }

    let mut requested_service_ports: BTreeMap<u16, Vec<String>> = BTreeMap::new();
    for (name, service) in &config.services {
        if let Some(port) = service.port.filter(|port| *port > 0) {
            requested_service_ports
                .entry(port)
                .or_default()
                .push(format!("service '{name}'"));
        }
    }
    for (port, owners) in &requested_service_ports {
        if owners.len() > 1 {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                message: format!(
                    "Configured service port {port} is repeated by {}. Warpforge allocates distinct runtime ports, but each command must honor the injected PORT value.",
                    owners.join(" and ")
                ),
            });
        }
        if let Some(portforwards) = fixed_ports.get(port) {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                message: format!(
                    "Configured service port {port} also appears as {}; verify the service honors injected PORT. Port-forward localPort is fixed.",
                    portforwards.join(" and ")
                ),
            });
        }
    }

    Ok((config, issues))
}

fn dependency_cycles(config: &crate::config::WorkspaceConfig) -> Vec<Vec<String>> {
    fn visit(
        name: &str,
        config: &crate::config::WorkspaceConfig,
        states: &mut HashMap<String, u8>,
        stack: &mut Vec<String>,
        seen_cycles: &mut HashSet<String>,
        cycles: &mut Vec<Vec<String>>,
    ) {
        states.insert(name.to_string(), 1);
        stack.push(name.to_string());

        if let Some(service) = config.services.get(name) {
            for dependency in &service.depends_on {
                if !config.services.contains_key(dependency) {
                    continue;
                }
                match states.get(dependency).copied().unwrap_or(0) {
                    0 => visit(dependency, config, states, stack, seen_cycles, cycles),
                    1 => {
                        if let Some(start) = stack.iter().position(|item| item == dependency) {
                            let mut cycle = stack[start..].to_vec();
                            cycle.push(dependency.clone());
                            let key = cycle.join(" -> ");
                            if seen_cycles.insert(key) {
                                cycles.push(cycle);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        stack.pop();
        states.insert(name.to_string(), 2);
    }

    let mut names: Vec<_> = config.services.keys().cloned().collect();
    names.sort();
    let mut states = HashMap::new();
    let mut stack = Vec::new();
    let mut seen_cycles = HashSet::new();
    let mut cycles = Vec::new();
    for name in names {
        if states.get(&name).copied().unwrap_or(0) == 0 {
            visit(
                &name,
                config,
                &mut states,
                &mut stack,
                &mut seen_cycles,
                &mut cycles,
            );
        }
    }
    cycles
}
