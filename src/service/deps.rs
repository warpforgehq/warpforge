//! `dependsOn` gating: a dependent is held as a process-less `Starting`
//! placeholder until every dependency is ready, and fails if one does not.
//! A dependent failed that way keeps its dependencies and starts if they recover.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::{ManagedService, ServiceEvent, ServiceManager, ServiceStatus};
use crate::ports;

/// What a dependency currently means for a service waiting on it.
#[derive(Debug, Clone, PartialEq)]
pub enum DepState {
    Ready,
    Pending,
    /// The dependency will not become ready; the text completes "dependency x …".
    Unavailable(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Gate {
    Go,
    Wait,
    Fail(String),
}

/// Where a service's port comes from: its project's range, the declared port
/// (0 = none), how strictly that port is pinned, and a range conflict that
/// refuses every port.
#[derive(Debug, Clone)]
pub struct PortClaim {
    pub range: (u16, u16),
    pub pin: ports::PortPin,
    pub port: u16,
    pub conflict: Option<String>,
}

/// Decide whether a service may start given its dependencies' states. An
/// unavailable dependency fails the gate even while others are still pending.
pub fn dependency_gate(deps: &[String], state: impl Fn(&str) -> DepState) -> Gate {
    let mut pending = false;
    for dep in deps {
        match state(dep) {
            DepState::Ready => {}
            DepState::Pending => pending = true,
            DepState::Unavailable(why) => {
                return Gate::Fail(format!("did not start: dependency {dep} {why}"))
            }
        }
    }
    if pending {
        Gate::Wait
    } else {
        Gate::Go
    }
}

impl ServiceManager {
    /// Record a service as waiting on `deps` without spawning anything. Its
    /// port is reserved now, so `${name.port}` resolves for services that
    /// start before it does.
    pub fn mark_waiting(
        &mut self,
        project_name: &str,
        service_name: &str,
        command: &str,
        claim: PortClaim,
        deps: Vec<String>,
    ) {
        self.hold(project_name, service_name, command, claim, deps, None);
    }

    /// Fail a service that will not be started, recording `message` as the reason.
    pub fn fail_start(
        &mut self,
        project_name: &str,
        service_name: &str,
        command: &str,
        message: String,
    ) {
        let key = format!("{project_name}/{service_name}");
        self.record_start_failure(&key, project_name, service_name, command, message);
    }

    /// Fail a service whose dependency will not be ready, but keep `deps` and
    /// its reserved port so it still starts if they all become ready later.
    pub fn fail_waiting(
        &mut self,
        project_name: &str,
        service_name: &str,
        command: &str,
        claim: PortClaim,
        message: String,
        deps: Vec<String>,
    ) {
        self.hold(
            project_name,
            service_name,
            command,
            claim,
            deps,
            Some(message),
        );
    }

    /// Replace the entry with a process-less one held on `deps`: `Starting`,
    /// or `Failed` with `failure` as the reason. A port that cannot be claimed
    /// fails the service outright instead.
    fn hold(
        &mut self,
        project_name: &str,
        service_name: &str,
        command: &str,
        claim: PortClaim,
        deps: Vec<String>,
        failure: Option<String>,
    ) {
        let key = format!("{project_name}/{service_name}");
        let allocated_port = match self.claim_port(&key, project_name, service_name, &claim) {
            Ok(port) => port,
            Err(message) => {
                self.record_start_failure(&key, project_name, service_name, command, message);
                return;
            }
        };
        let (status, line) = match &failure {
            None => (
                ServiceStatus::Starting,
                format!("[service waiting for {}]", deps.join(", ")),
            ),
            Some(message) => (ServiceStatus::Failed, format!("[service failed] {message}")),
        };
        let run_id = self.next_run_id;
        self.next_run_id = self.next_run_id.saturating_add(1);
        let existing = self.services.get(&key);
        let existing_logs = existing.map(|s| s.logs.clone()).unwrap_or_default();
        let next_seq = existing_logs
            .last()
            .map(|l| l.seq.saturating_add(1))
            .unwrap_or(0);
        let mut managed = ManagedService {
            name: service_name.to_string(),
            project_name: project_name.to_string(),
            command: command.to_string(),
            status,
            logs: existing_logs,
            next_seq,
            original_port: claim.port,
            env: Default::default(),
            allocated_port,
            port_pinned: claim.pin == ports::PortPin::Strict,
            port_warning: None,
            // An exited run's group stays reachable so the next start or stop reaps it.
            pgid: existing.and_then(|s| s.pgid),
            alive: false,
            run_id,
            waiting_on: deps,
            stopping: Arc::new(AtomicBool::new(false)),
            port_watch: None,
        };
        managed.push_log(line);
        self.services.insert(key.clone(), managed);
        // Dependents re-check on this event, so a failure propagates down the chain.
        if failure.is_some() {
            let _ = self.event_tx.send(ServiceEvent::StatusChange {
                key,
                run_id,
                status: ServiceStatus::Failed,
                exit_code: None,
            });
        }
    }

    /// The port for `key`'s next run: the one its held entry reserved while
    /// that still satisfies `claim`, else a fresh allocation.
    pub(super) fn claim_port(
        &self,
        key: &str,
        project_name: &str,
        service_name: &str,
        claim: &PortClaim,
    ) -> Result<u16, String> {
        let (start, end) = claim.range;
        let reserved = self
            .services
            .get(key)
            .filter(|s| !s.waiting_on.is_empty() && claim.port > 0)
            .map(|s| s.allocated_port)
            .filter(|&port| {
                (start..=end).contains(&port)
                    && (claim.pin == ports::PortPin::Auto || port == claim.port)
            });
        if let (Some(port), None) = (reserved, &claim.conflict) {
            return Ok(port);
        }
        ports::release(project_name, service_name);
        if let Some(reason) = &claim.conflict {
            Err(reason.clone())
        } else if claim.port > 0 {
            ports::allocate(
                claim.range,
                project_name,
                service_name,
                claim.port,
                claim.pin,
            )
        } else {
            Ok(0)
        }
    }

    /// Services of a project held on dependencies: `(name, deps, failed)`.
    /// A failed one was refused because a dependency was not ready.
    pub fn waiting_in_project(&self, project_name: &str) -> Vec<(String, Vec<String>, bool)> {
        let mut waiting: Vec<_> = self
            .services
            .values()
            .filter(|s| {
                s.project_name == project_name
                    && matches!(s.status, ServiceStatus::Starting | ServiceStatus::Failed)
                    && !s.waiting_on.is_empty()
            })
            .map(|s| {
                let failed = s.status == ServiceStatus::Failed;
                (s.name.clone(), s.waiting_on.clone(), failed)
            })
            .collect();
        waiting.sort();
        waiting
    }
}
