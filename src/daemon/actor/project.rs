use std::collections::HashSet;

use anyhow::Result;

use crate::config::{load_workspace_config, WorkspaceConfig};
use crate::portforward::PfStatus;
use crate::registry::ProjectEntry;
use crate::service::{kill_listeners_on_ports, ServiceStatus};

use crate::daemon::actor::event::ProjectLiveResources;
use crate::daemon::actor::{Daemon, Event, ProjectRemovalError};

impl Daemon {
    pub(crate) async fn open_project(&mut self, name: &str) {
        self.start_services(name).await;
        self.start_portforwards(name).await;
    }

    /// Retire runtime entries that the refreshed config can no longer control.
    /// Existing services whose command changed keep running until the user
    /// restarts them; removed services and changed/removed forwards are stopped
    /// so no invisible processes are left behind.
    pub(crate) async fn remove_undeclared_runtime(
        &mut self,
        project: &str,
        config: Option<&WorkspaceConfig>,
    ) {
        let declared_services: HashSet<&str> = config
            .map(|config| config.services.keys().map(String::as_str).collect())
            .unwrap_or_default();
        let removed_services: Vec<String> = self
            .services
            .list_for_project(project)
            .into_iter()
            .filter(|service| !declared_services.contains(service.name.as_str()))
            .map(|service| service.name.clone())
            .collect();
        for service in removed_services {
            self.services.remove(project, &service).await.ok();
        }

        let removed_or_changed_forwards: Vec<String> = self
            .portforwards
            .list_for_project(project)
            .into_iter()
            .filter(|running| {
                !config.is_some_and(|config| {
                    config.portforwards.iter().any(|declared| {
                        let name = declared
                            .name
                            .as_deref()
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("{}:{}", declared.namespace, declared.pod));
                        name == running.name
                            && declared.namespace == running.namespace
                            && declared.pod == running.pod_prefix
                            && declared.local_port == running.local_port
                            && declared.remote_port == running.remote_port
                    })
                })
            })
            .map(|forward| forward.name.clone())
            .collect();
        for forward in removed_or_changed_forwards {
            self.portforwards.remove(project, &forward);
        }
        self.advance_waiting(project).await;
    }

    /// Register a new project: write to registry, generate config if missing,
    /// add to in-memory list, and broadcast the update to all clients.
    pub(crate) async fn add_project(
        &mut self,
        path: &str,
        name: Option<&str>,
        port_range: Option<crate::registry::PortRange>,
    ) -> Result<ProjectEntry, String> {
        let entry = crate::registry::add_project(path, name, port_range)
            .map_err(|e| format!("registry: {e}"))?;

        // Generate the workspace config if none exists.
        let config_file = crate::config::find_config_file(std::path::Path::new(&entry.path));
        if !config_file.exists() {
            crate::config::generate_workspace_yaml(std::path::Path::new(&entry.path)).ok();
            // non-fatal if it fails
        }

        // Add to in-memory list.
        self.projects.push(entry.clone());
        self.config_observer.track(&entry);
        self.load_linked_spaces();
        // The new project may relocate other projects' sticky ranges; every
        // moved project must be broadcast, not just the new one.
        let mut affected = self.recompute_port_ranges();
        if !affected.iter().any(|name| name == &entry.name) {
            affected.push(entry.name.clone());
        }

        // Broadcast to all subscribed clients.
        let state = self.build_project_config_state(&entry.name);
        self.emit(Event::ProjectAdded(state.project.clone()));
        self.broadcast_project_config(&affected);

        Ok(entry)
    }

    /// Stop and forget all project-owned runtime resources, then unregister the
    /// project. The actor serializes this operation so starts cannot interleave.
    pub(crate) async fn remove_project(
        &mut self,
        name: &str,
        stop_resources: bool,
    ) -> Result<(), ProjectRemovalError> {
        let Some(_) = self
            .projects
            .iter()
            .position(|project| project.name == name)
        else {
            return Err(ProjectRemovalError::NotFound(format!(
                "Project \"{name}\" is not registered"
            )));
        };

        let live = ProjectLiveResources {
            services: self
                .services
                .list_for_project(name)
                .iter()
                .filter(|service| {
                    service.process_alive()
                        || matches!(
                            service.status,
                            ServiceStatus::Starting | ServiceStatus::Running
                        )
                })
                .count(),
            portforwards: self
                .portforwards
                .list_for_project(name)
                .iter()
                .filter(|forward| {
                    matches!(
                        forward.status,
                        PfStatus::Starting | PfStatus::Active | PfStatus::Restarting
                    )
                })
                .count(),
            terminals: self
                .agents
                .list_for_project(name)
                .iter()
                .filter(|agent| agent.status.is_live_terminal())
                .count(),
        };
        if live.any() && !stop_resources {
            return Err(ProjectRemovalError::Conflict(live.conflict_message(name)));
        }

        let service_names: Vec<String> = self
            .services
            .list_for_project(name)
            .into_iter()
            .map(|service| service.name.clone())
            .collect();
        for service in service_names {
            self.services
                .remove(name, &service)
                .await
                .map_err(|error| {
                    ProjectRemovalError::Internal(format!(
                        "Failed to stop service \"{service}\" for project \"{name}\": {error}"
                    ))
                })?;
        }

        let portforward_names: Vec<String> = self
            .portforwards
            .list_for_project(name)
            .into_iter()
            .map(|forward| forward.name.clone())
            .collect();
        for forward in portforward_names {
            self.portforwards.remove(name, &forward);
        }

        // Only ports this daemon handed out — a declared range can hold
        // processes warpforge never started (ADR 0006 invariant 3).
        if stop_resources {
            if let Some(range) = self.port_range_for(name) {
                kill_listeners_on_ports(&crate::ports::allocated_in_ranges(&[range])).await;
            }
        }

        let terminal_ids: Vec<String> = self
            .agents
            .list_for_project(name)
            .into_iter()
            .map(|agent| agent.id.clone())
            .collect();
        for id in terminal_ids {
            self.agents.kill(&id);
            self.emit(Event::AgentExited { id });
        }

        crate::registry::remove_project(name).map_err(|error| {
            ProjectRemovalError::Internal(format!(
                "Resources were stopped, but project registration removal failed: {error}"
            ))
        })?;

        self.projects.retain(|p| p.name != name);
        self.config_observer.untrack(name);
        self.port_ranges.remove(name);
        // Removing a project frees its range; relocated neighbours must be
        // broadcast, not just the removal itself.
        let affected = self.recompute_port_ranges();

        self.emit(Event::ProjectRemoved {
            name: name.to_string(),
        });
        self.broadcast_project_config(&affected);

        Ok(())
    }

    /// Start every declared port-forward for a project (no services).
    pub(crate) async fn start_portforwards(&mut self, name: &str) {
        let Some(path) = self.project_path(name) else {
            return;
        };
        let Some(config) = load_workspace_config(std::path::Path::new(&path)) else {
            return;
        };
        self.portforwards
            .start_all(name, &config.portforwards)
            .await;
    }

    /// Start a single declared port-forward, matched by its label (explicit
    /// `name:` in config, else the `namespace:pod` fallback the manager uses).
    pub(crate) async fn start_one_portforward(&mut self, project: &str, label: &str) {
        let Some(path) = self.project_path(project) else {
            return;
        };
        let Some(config) = load_workspace_config(std::path::Path::new(&path)) else {
            return;
        };
        let matched: Vec<_> = config
            .portforwards
            .into_iter()
            .filter(|cfg| {
                let cfg_label = cfg
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("{}:{}", cfg.namespace, cfg.pod));
                cfg_label == label
            })
            .collect();
        self.portforwards.start_all(project, &matched).await;
    }

    /// A context block describing the project's currently-running services and
    /// their live URLs — prepended to the agent's first prompt so it knows the
    /// app is already up and can hit real endpoints / run tests against it.
    ///
    /// For a task that runs in its own worktree the block says plainly that the
    /// services serve the main checkout, not the worktree, so the agent does not
    /// read a restart as having picked up its edits.
    pub(crate) fn runtime_context(
        &self,
        project: &str,
        task_id: &str,
        include_services: bool,
    ) -> Option<String> {
        let folders = self
            .tasks
            .get(task_id)
            .and_then(|task| crate::daemon::spaces::workspace_folders(&task.workspace_folders));
        let services = include_services
            .then(|| self.runtime_services(project, task_id))
            .flatten();
        match (folders, services) {
            (Some(folders), Some(services)) => Some(format!("{folders}\n\n{services}")),
            (folders, services) => folders.or(services),
        }
    }

    fn runtime_services(&self, project: &str, task_id: &str) -> Option<String> {
        let mut lines: Vec<String> = self
            .services
            .all()
            .filter(|s| {
                s.project_name == project
                    && s.allocated_port > 0
                    && matches!(s.status, ServiceStatus::Running | ServiceStatus::Starting)
            })
            .map(|s| runtime_service_line(&s.name, &s.status, s.allocated_port))
            .collect();
        if lines.is_empty() {
            return None;
        }
        lines.sort();
        let checkout = self.runtime_checkout(project, task_id);
        Some(format!(
            "[warpforge] {}\n{}",
            runtime_checkout_note(checkout.as_ref()),
            lines.join("\n")
        ))
    }

    /// Where a worktree task's services actually run. `None` when the task does
    /// not run in a worktree, so the services are its own checkout.
    fn runtime_checkout(&self, project: &str, task_id: &str) -> Option<RuntimeCheckout> {
        let task = self.tasks.get(task_id)?;
        let worktree = task.worktree.as_deref()?;
        let root = self.project_path(project)?;
        Some(RuntimeCheckout {
            root,
            worktree: worktree.to_string(),
        })
    }

    /// Spawn an ACP agent session for a task and remember its handle. When
    /// `resume` is set, load that native session id instead of starting fresh.
    /// Some agents replay prior history as `session/update`; the frontend stream
    /// is append-only today, so this path is used primarily to regain a live
    /// handle and deliver a new prompt after daemon restarts.
    ///
    /// Broadcast a service's current status. Emitted right after a start so a
    /// client learns the service exists (it may have subscribed before it did)
    /// — without this, newly started services never appear for other clients.
    pub(crate) fn emit_service_status(&self, project: &str, service: &str) {
        if let Some(svc) = self.services.get(project, service) {
            self.emit(Event::ServiceStatus {
                project: project.to_string(),
                service: service.to_string(),
                status: svc.status.clone(),
                allocated_port: svc.allocated_port,
                needs_restart: self.service_needs_restart(project, svc),
            });
            self.emit_port_warning(project, service);
        }
    }

    pub(crate) fn emit_port_warning(&self, project: &str, service: &str) {
        if let Some(svc) = self.services.get(project, service) {
            self.emit(Event::ServicePortWarning {
                project: project.to_string(),
                service: service.to_string(),
                warning: crate::daemon::wire::port_warning(&svc.port_warning),
            });
        }
    }

    pub(crate) fn emit_portforward_status(&self, project: &str, name: &str) {
        let key = format!("{project}/{name}");
        if let Some(pf) = self.portforwards.forwards.get(&key) {
            self.emit(Event::PortForwardStatus {
                project: project.to_string(),
                name: name.to_string(),
                status: pf.status.clone(),
            });
        }
    }

    pub(crate) fn emit_portforward_statuses(&self, project: &str, names: &[String]) {
        for name in names {
            self.emit_portforward_status(project, name);
        }
    }

    pub(crate) async fn stop_runtime(&mut self) {
        let services: Vec<(String, String)> = self
            .services
            .list()
            .into_iter()
            .map(|svc| (svc.project_name.clone(), svc.name.clone()))
            .collect();
        let pfs: Vec<(String, String)> = self
            .portforwards
            .forwards
            .keys()
            .map(|key| {
                let parts: Vec<&str> = key.splitn(2, '/').collect();
                (
                    parts.first().map(|s| s.to_string()).unwrap_or_default(),
                    parts.get(1).map(|s| s.to_string()).unwrap_or_default(),
                )
            })
            .collect();
        self.services.stop_all().await.ok();
        self.portforwards.stop_all().await.ok();
        // Only ports this daemon handed out — a declared range can hold
        // processes warpforge never started (ADR 0006 invariant 3).
        kill_listeners_on_ports(&crate::ports::allocated_in_ranges(
            &self.project_port_ranges(),
        ))
        .await;
        for (project, service) in services {
            self.emit_service_status(&project, &service);
        }
        for (project, name) in pfs {
            self.emit_portforward_status(&project, &name);
        }
    }

    pub(crate) fn project_port_ranges(&self) -> Vec<(u16, u16)> {
        self.projects
            .iter()
            .filter_map(|p| self.port_range_for(&p.name))
            .collect()
    }
}

/// The checkout a worktree task's services really run from, for the runtime
/// preamble.
pub(crate) struct RuntimeCheckout {
    pub(crate) root: String,
    pub(crate) worktree: String,
}

/// The sentence that opens the runtime context block. A worktree task is told
/// its services serve a different checkout; every other task gets the original
/// wording, which is true for it.
pub(crate) fn runtime_checkout_note(checkout: Option<&RuntimeCheckout>) -> String {
    match checkout {
        None => "These services are already running for this project — you can hit these endpoints and run tests against them:".to_string(),
        Some(c) => format!(
            "These services are already running for this project, but they serve the main \
             checkout at {} — not your worktree at {}. Restarting a service will not pick up \
             your edits; you can still hit these endpoints to test the running app:",
            c.root, c.worktree
        ),
    }
}

/// One bullet for a running/starting service. A starting service is labelled so
/// an agent does not treat a half-up server as ready.
pub(crate) fn runtime_service_line(name: &str, status: &ServiceStatus, port: u16) -> String {
    match status {
        ServiceStatus::Starting => format!("- {name} → http://localhost:{port} (starting)"),
        _ => format!("- {name} → http://localhost:{port}"),
    }
}

/// The working directory a task's terminal should start in: its worktree when
/// one exists on disk, else the project root.
pub(crate) fn resolve_terminal_cwd(root: &str, worktree: Option<&str>) -> String {
    if let Some(worktree) = worktree {
        if std::path::Path::new(worktree).is_dir() {
            return worktree.to_string();
        }
    }
    root.to_string()
}
