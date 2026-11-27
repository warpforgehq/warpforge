//! Which web origins an agent may act on in the in-app browser without asking.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use warpforge_protocol as wire;

/// Origins the user allowed "always" for a task, for the daemon's lifetime.
#[derive(Default)]
pub(crate) struct Grants(Mutex<HashMap<String, HashSet<String>>>);

impl Grants {
    /// The origins granted to a task.
    /// @param task_id the task
    /// @returns the granted origins, unordered
    pub(crate) fn of(&self, task_id: &str) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .get(task_id)
            .map(|origins| origins.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Allow `origin` for the rest of the task.
    /// @param task_id the task
    /// @param origin the origin the user allowed
    pub(crate) fn add(&self, task_id: &str, origin: &str) {
        self.0
            .lock()
            .unwrap()
            .entry(task_id.to_string())
            .or_default()
            .insert(origin.to_string());
    }
}

/// The origins the project's own dev services and port-forwards answer on:
/// every loopback spelling of every port the runtime allocated.
/// @param snapshot the daemon's current state
/// @param project the project
/// @returns the origins, e.g. `http://localhost:4001`
pub(crate) fn service_origins(snapshot: &wire::Snapshot, project: &str) -> Vec<String> {
    let services = snapshot
        .services
        .iter()
        .filter(|s| s.project == project)
        .map(|s| s.allocated_port);
    let forwards = snapshot
        .portforwards
        .iter()
        .filter(|pf| pf.project == project)
        .map(|pf| pf.local_port);
    let mut ports: Vec<u16> = services.chain(forwards).filter(|&p| p != 0).collect();
    ports.sort_unstable();
    ports.dedup();
    let mut origins = Vec::new();
    for port in ports {
        for host in ["localhost", "127.0.0.1", "[::1]"] {
            for scheme in ["http", "https"] {
                origins.push(format!("{scheme}://{host}:{port}"));
            }
        }
    }
    origins
}

/// Normalise a URL the agent asked to open and name its origin. A bare
/// `localhost:4001/path` means `http://`.
/// @param url the URL as the agent gave it
/// @returns the URL to load and its origin, or why it is not a web page
pub(crate) fn web_url(url: &str) -> Result<(String, String), String> {
    let trimmed = url.trim();
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let parsed =
        reqwest::Url::parse(&candidate).map_err(|e| format!("invalid URL {url:?}: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok((parsed.to_string(), parsed.origin().ascii_serialization())),
        other => Err(format!(
            "only http and https pages can be opened, not {other}: URLs"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(project: &str, port: u16) -> wire::ServiceInfo {
        wire::ServiceInfo {
            project: project.into(),
            name: format!("svc{port}"),
            command: String::new(),
            status: wire::ServiceStatus::Running,
            original_port: port,
            allocated_port: port,
            checkout: String::new(),
            port_pinned: false,
            port_warning: None,
            log_seq: 0,
            local: false,
            local_fields: Vec::new(),
            needs_restart: false,
        }
    }

    #[test]
    fn only_the_projects_allocated_ports_are_service_origins() {
        let snapshot = wire::Snapshot {
            services: vec![
                service("demo", 4001),
                service("other", 4101),
                service("demo", 0),
            ],
            ..Default::default()
        };
        let origins = service_origins(&snapshot, "demo");
        assert!(origins.contains(&"http://localhost:4001".to_string()));
        assert!(origins.contains(&"http://127.0.0.1:4001".to_string()));
        assert!(origins.contains(&"https://[::1]:4001".to_string()));
        assert!(!origins.iter().any(|o| o.ends_with(":4101")));
        assert_eq!(origins.len(), 6);
    }

    #[test]
    fn urls_are_normalised_and_non_web_schemes_refused() {
        assert_eq!(
            web_url("localhost:4001/login").unwrap(),
            (
                "http://localhost:4001/login".to_string(),
                "http://localhost:4001".to_string()
            )
        );
        assert_eq!(
            web_url("https://GitHub.com/x").unwrap().1,
            "https://github.com"
        );
        assert!(web_url("javascript:alert(1)").is_err());
        assert!(web_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn grants_are_per_task() {
        let grants = Grants::default();
        grants.add("t1", "https://github.com");
        assert_eq!(grants.of("t1"), vec!["https://github.com".to_string()]);
        assert!(grants.of("t2").is_empty());
    }
}
