use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{Duration, Instant};

use warpforge_protocol as wire;

use crate::config::{sorted_services, WorkspaceConfig};
use crate::config_local::ensure_local_ignored;
use crate::registry::ProjectEntry;
use crate::service::ServiceStatus;

use super::project_config::ConfigFiles;
use crate::daemon::actor::Daemon;
use crate::daemon::wire as wireconv;

/// Split a `project/service` service key back into its parts (split on first
/// `/`, which is how `ServiceManager` composes the key).
pub(crate) fn split_key(key: &str) -> (String, String) {
    match key.split_once('/') {
        Some((p, s)) => (p.to_string(), s.to_string()),
        None => (String::new(), key.to_string()),
    }
}

pub(crate) const CONFIG_POLL_INTERVAL: Duration = Duration::from_millis(250);
pub(crate) const CONFIG_CHANGE_DEBOUNCE: Duration = Duration::from_millis(200);

/// How often the daemon re-runs history pruning. The first sweep happens at
/// start, so a shortened window applies without waiting a day.
pub(crate) const HISTORY_PRUNE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Content-based, debounced observer for registered project configs.
///
/// Resolving the active config path on each pass rather than tracking one inode
/// is important because many editors save by replacing the file atomically.
/// Polling the small config files also keeps the daemon cross-platform without
/// another native watcher dependency.
pub(crate) struct ConfigObserver {
    applied: HashMap<String, ConfigFiles>,
    pending: HashMap<String, (ConfigFiles, Instant)>,
    configs: HashMap<String, WorkspaceConfig>,
    errors: HashMap<String, wire::ConfigError>,
}

impl ConfigObserver {
    pub(crate) fn new(projects: &[ProjectEntry]) -> Self {
        let mut observer = Self {
            applied: HashMap::new(),
            pending: HashMap::new(),
            configs: HashMap::new(),
            errors: HashMap::new(),
        };
        for project in projects {
            observer.track(project);
        }
        observer
    }

    pub(crate) fn track(&mut self, project: &ProjectEntry) {
        let root = Path::new(&project.path);
        ensure_local_ignored(root);
        self.observe(&project.name, root, ConfigFiles::read(root));
    }

    pub(crate) fn untrack(&mut self, project: &str) {
        self.applied.remove(project);
        self.pending.remove(project);
        self.configs.remove(project);
        self.errors.remove(project);
    }

    pub(super) fn config(&self, project: &str) -> Option<&WorkspaceConfig> {
        self.configs.get(project)
    }

    fn ready(&mut self, projects: &[ProjectEntry], now: Instant) -> Vec<(String, ConfigFiles)> {
        let registered: HashSet<&str> = projects.iter().map(|p| p.name.as_str()).collect();
        self.applied
            .retain(|project, _| registered.contains(project.as_str()));
        self.pending
            .retain(|project, _| registered.contains(project.as_str()));

        let mut ready = Vec::new();
        for project in projects {
            let current = ConfigFiles::read(Path::new(&project.path));
            if self.applied.get(&project.name) == Some(&current) {
                self.pending.remove(&project.name);
                continue;
            }

            match self.pending.get_mut(&project.name) {
                Some((pending, since)) if *pending == current => {
                    if now.duration_since(*since) >= CONFIG_CHANGE_DEBOUNCE {
                        ready.push((project.name.clone(), current));
                    }
                }
                Some((pending, since)) => {
                    *pending = current;
                    *since = now;
                }
                None => {
                    self.pending.insert(project.name.clone(), (current, now));
                }
            }
        }
        ready
    }

    fn observe(&mut self, project: &str, root: &Path, files: ConfigFiles) -> bool {
        let config = files.load(root, project);
        self.applied.insert(project.to_string(), files);
        self.pending.remove(project);
        match config {
            Ok(config) => {
                self.errors.remove(project);
                if let Some(config) = config {
                    self.configs.insert(project.to_string(), config);
                } else {
                    self.configs.remove(project);
                }
                true
            }
            Err(error) => {
                self.errors.insert(project.to_string(), error);
                false
            }
        }
    }
}

impl Daemon {
    pub(crate) async fn handle_config_changes(&mut self) {
        for (project, files) in self.config_observer.ready(&self.projects, Instant::now()) {
            self.apply_config_files(&project, files).await;
        }
    }

    pub(super) async fn apply_config_files(&mut self, project: &str, files: ConfigFiles) {
        let Some(path) = self.project_path(project) else {
            return;
        };
        let root = Path::new(&path);
        if !self.config_observer.observe(project, root, files) {
            self.broadcast_project_config(&[project.to_string()]);
            return;
        }
        ensure_local_ignored(root);
        let config = self.config_observer.config(project).cloned();
        if let Some(config) = &config {
            self.merge_space_links([(project.to_string(), config.linked.clone())]);
        }
        self.remove_undeclared_runtime(project, config.as_ref())
            .await;
        self.recompute_and_broadcast_port_ranges(Some(project));
    }

    pub(super) fn service_needs_restart(
        &self,
        project: &str,
        service: &crate::service::ManagedService,
    ) -> bool {
        self.config_observer
            .config(project)
            .and_then(|config| config.services.get(&service.name))
            .is_some_and(|definition| service.needs_restart(definition))
    }

    pub(crate) fn build_project_config_state(
        &self,
        project_name: &str,
    ) -> wire::ProjectConfigState {
        let Some(project) = self.projects.iter().find(|p| p.name == project_name) else {
            panic!("build_project_config_state: unknown project {project_name:?}");
        };
        let config = self.config_observer.config(project_name);
        let (start, end) = self.port_range_for(&project.name).unwrap_or((4000, 4099));
        let (port_range_source, port_range_conflict) = self
            .port_ranges
            .get(&project.name)
            .map(|resolved| {
                (
                    crate::daemon::actor::ports::range_source(resolved.source),
                    resolved.conflict_with.clone(),
                )
            })
            .unwrap_or((wire::PortRangeSource::Auto, None));
        let declared_services = config.map(sorted_services).unwrap_or_default();
        let agent_templates = config
            .and_then(|c| c.agent_templates.as_ref())
            .map(|templates| {
                templates
                    .iter()
                    .map(|(name, template)| (name.clone(), template.command.clone()))
                    .collect()
            })
            .unwrap_or_default();

        // Start from every declared service in a stopped state, then overlay a
        // matching live process. This lets clients render Start controls before
        // a service has ever been launched.
        let mut service_map: HashMap<String, wire::ServiceInfo> = config
            .map(|config| {
                config
                    .services
                    .iter()
                    .map(|(name, service)| {
                        (
                            name.clone(),
                            wire::ServiceInfo {
                                project: project.name.clone(),
                                name: name.clone(),
                                command: service.command.clone(),
                                status: wire::ServiceStatus::Stopped,
                                original_port: service.port.unwrap_or(0),
                                allocated_port: 0,
                                checkout: project.path.clone(),
                                // A pinned service that has never started is
                                // still pinned: report from the resolved
                                // range, not from a live process.
                                port_pinned: self.port_pin_for(&project.name, service)
                                    == crate::ports::PortPin::Strict,
                                port_warning: None,
                                log_seq: 0,
                                needs_restart: false,
                                local: config.local.services.contains_key(name),
                                local_fields: config
                                    .local
                                    .services
                                    .get(name)
                                    .cloned()
                                    .unwrap_or_default(),
                            },
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        for service in self.services.list_for_project(&project.name) {
            if let Some(declared) = service_map.get_mut(&service.name) {
                declared.needs_restart = self.service_needs_restart(project_name, service);
                declared.status = wireconv::service_status(&service.status);
                declared.allocated_port = service.allocated_port;
                declared.port_pinned = service.port_pinned;
                declared.port_warning = wireconv::port_warning(&service.port_warning);
                declared.log_seq = self.services.newest_seq(&project.name, &service.name);
                if matches!(
                    service.status,
                    ServiceStatus::Starting | ServiceStatus::Running
                ) {
                    // A running process still reflects the definition it was
                    // launched with. Stopped/failed entries use the refreshed
                    // config so their next Start is represented accurately.
                    declared.command = service.command.clone();
                    declared.original_port = service.original_port;
                }
            }
        }
        let mut services: Vec<_> = service_map.into_values().collect();
        services.sort_by(|a, b| a.name.cmp(&b.name));

        // As with services, declared port-forwards exist in client state even
        // before kubectl has been started. Live state wins only while that
        // forward is still present in the current config.
        let mut pf_map: HashMap<String, wire::PortForwardInfo> = config
            .map(|config| {
                config
                    .portforwards
                    .iter()
                    .map(|pf| {
                        let name = pf
                            .name
                            .clone()
                            .unwrap_or_else(|| format!("{}:{}", pf.namespace, pf.pod));
                        (
                            name.clone(),
                            wire::PortForwardInfo {
                                project: project.name.clone(),
                                name: name.clone(),
                                namespace: pf.namespace.clone(),
                                pod: pf.pod.clone(),
                                local_port: pf.local_port,
                                remote_port: pf.remote_port,
                                status: wire::PortForwardStatus::Stopped,
                                log_seq: 0,
                                local: config.local.portforwards.contains_key(&name),
                                local_fields: config
                                    .local
                                    .portforwards
                                    .get(&name)
                                    .cloned()
                                    .unwrap_or_default(),
                            },
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        for pf in self.portforwards.list_for_project(&project.name) {
            if let Some(declared) = pf_map.get(&pf.name) {
                let (local, local_fields) = (declared.local, declared.local_fields.clone());
                pf_map.insert(
                    pf.name.clone(),
                    wire::PortForwardInfo {
                        project: project.name.clone(),
                        name: pf.name.clone(),
                        namespace: pf.namespace.clone(),
                        pod: pf.pod_prefix.clone(),
                        local_port: pf.local_port,
                        remote_port: pf.remote_port,
                        status: wireconv::pf_status(&pf.status),
                        log_seq: self.portforwards.newest_seq(&project.name, &pf.name),
                        local,
                        local_fields,
                    },
                );
            }
        }
        let mut portforwards: Vec<_> = pf_map.into_values().collect();
        portforwards.sort_by(|a, b| a.name.cmp(&b.name));

        wire::ProjectConfigState {
            project: wire::ProjectInfo {
                name: project.name.clone(),
                path: project.path.clone(),
                port_range: (start, end),
                port_range_source,
                port_range_conflict,
                declared_services,
                agent_templates,
                config_error: self.config_observer.errors.get(project_name).cloned(),
                local_config_error: config.and_then(|c| c.local_error.clone()),
                linked: config
                    .map(|c| {
                        c.linked
                            .iter()
                            .filter(|link| link.is_relative())
                            .map(|link| {
                                crate::daemon::spaces::linked_path(
                                    std::path::Path::new(&project.path),
                                    link,
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            },
            services,
            portforwards,
        }
    }
}
