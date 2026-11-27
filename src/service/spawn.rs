//! Spawning: port allocation, environment interpolation, and the async tasks
//! that stream a process's logs, readiness, and exit into [`ServiceEvent`]s.

use anyhow::Result;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::port_watch::{port_answers, spawn_port_watch, WatchTiming};
use super::ready::{spawn_readiness, Probe, Readiness, RunHandle};
use super::{ManagedService, PortClaim, ServiceEvent, ServiceManager, ServiceStatus};
use crate::ports;

/// An empty `ready_pattern` means "heuristics only".
fn line_indicates_ready(line: &str, ready_pattern: &str) -> bool {
    if !ready_pattern.is_empty() && line.contains(ready_pattern) {
        return true;
    }
    let lower = line.to_ascii_lowercase();
    lower.contains("ready in")
        || lower.contains("listening on")
        || lower.contains("server running")
        || lower.contains("started server")
        || lower.contains("local:")
        || lower.contains("localhost:")
        || lower.contains("0.0.0.0:")
}

/// The service named by the first surviving `${svc.port}` placeholder in
/// `values`: one whose port was never allocated (failed pin, range conflict,
/// no declared port, or a typo in the placeholder).
fn unresolved_port_ref<'a>(
    values: impl IntoIterator<Item = &'a String>,
    port_map: &HashMap<String, u16>,
) -> Option<&'a str> {
    for value in values {
        let mut rest = value.as_str();
        while let Some(pos) = rest.find("${") {
            let Some(end) = rest[pos..].find('}') else {
                break;
            };
            let placeholder = &rest[pos + 2..pos + end];
            if let Some(dep) = placeholder.strip_suffix(".port") {
                if !port_map.contains_key(dep) {
                    return Some(dep);
                }
            }
            rest = &rest[pos + end + 1..];
        }
    }
    None
}

impl ServiceManager {
    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &mut self,
        project_name: &str,
        project_path: &str,
        range: (u16, u16),
        pin: ports::PortPin,
        service_name: &str,
        command: &str,
        original_port: u16,
        env: Option<&HashMap<String, String>>,
        readiness: &Readiness,
        // Set when the project's port ranges conflict — services refuse to
        // start until the conflict is resolved (ADR 0006 decision 4).
        conflict: Option<&str>,
    ) -> Result<()> {
        let key = format!("{project_name}/{service_name}");
        // Already running — skip. Stopped/Failed, or waiting on dependencies
        // with no process yet — allow start.
        if let Some(existing) = self.services.get_mut(&key) {
            let running = matches!(
                existing.status,
                ServiceStatus::Running | ServiceStatus::Starting
            ) && existing.waiting_on.is_empty();
            if running {
                return Ok(());
            }
            // Ensure any lingering old process group is gone before reallocating.
            existing.stopping.store(true, Ordering::SeqCst);
            existing.alive = false;
            let old_pgid = existing.pgid.take();
            super::stop::kill_group(old_pgid).await;
        }

        // A range conflict is a config problem: refuse loudly, exactly like a
        // pinned-port failure, instead of starting into someone else's ports.
        // A pinned port that cannot be bound fails the service — no fallback.
        let claim = PortClaim {
            range,
            pin,
            port: original_port,
            conflict: conflict.map(str::to_string),
        };
        let allocated_port = match self.claim_port(&key, project_name, service_name, &claim) {
            Ok(port) => port,
            Err(message) => {
                self.record_start_failure(&key, project_name, service_name, command, message);
                return Ok(());
            }
        };

        // Build env: interpolate ${svc.port} refs + inject PORT
        let mut port_map: HashMap<String, u16> = self
            .services
            .values()
            .filter(|s| s.project_name == project_name && s.allocated_port > 0)
            .map(|s| (s.name.clone(), s.allocated_port))
            .collect();
        if allocated_port > 0 {
            port_map.insert(service_name.to_string(), allocated_port);
        }

        let healthcheck_url = readiness
            .healthcheck_url
            .as_deref()
            .map(|url| ports::interpolate(url, &port_map));
        if let Some(dep) = healthcheck_url
            .as_ref()
            .and_then(|url| unresolved_port_ref([url], &port_map))
        {
            let why = if dep == service_name {
                "declares no port".to_string()
            } else {
                format!("has no allocated port; declare one for {dep} or start it first")
            };
            let message = format!("healthcheck url references ${{{dep}.port}} but {dep} {why}");
            self.record_start_failure(&key, project_name, service_name, command, message);
            return Ok(());
        }

        let resolved_command = ports::interpolate(command, &port_map);
        if let Some(dep) = unresolved_port_ref([&resolved_command], &port_map) {
            let message = format!(
                "command references ${{{dep}.port}} but {dep} has no allocated port; declare one for {dep} or start it first"
            );
            self.record_start_failure(&key, project_name, service_name, command, message);
            return Ok(());
        }

        let mut cmd = Command::new("sh");
        cmd.args(["-c", &resolved_command])
            .current_dir(project_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // Own process group so we can kill the entire subtree at once
        #[cfg(unix)]
        cmd.process_group(0);

        if allocated_port > 0 {
            cmd.env("PORT", allocated_port.to_string());
        }

        if let Some(env_vars) = env {
            let interpolated = ports::interpolate_env(env_vars, &port_map);
            // A surviving ${svc.port} placeholder means a dependency never got
            // a port (its pin failed, or its project has a range conflict).
            // Starting the dependent with the placeholder as a literal — a
            // URL, a config value — is a silent wrong-port bug. Invariant 4:
            // the dependent fails as loudly as the pin itself did.
            if let Some(dep) = unresolved_port_ref(interpolated.values(), &port_map) {
                let message = format!(
                    "service {service_name} references ${{{dep}.port}} but {dep} has no allocated port (its pinned port failed or its project has a range conflict); fix or start {dep} first"
                );
                self.record_start_failure(&key, project_name, service_name, command, message);
                return Ok(());
            }
            for (k, v) in &interpolated {
                cmd.env(k, v);
            }
        }

        let mut child = cmd.spawn()?;
        // Capture PGID right after spawn (== child PID when process_group(0) is used)
        #[cfg(unix)]
        let pgid: Option<u32> = child.id();
        #[cfg(not(unix))]
        let pgid: Option<u32> = None;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stopping = Arc::new(AtomicBool::new(false));
        let run_id = self.next_run_id;
        self.next_run_id = self.next_run_id.saturating_add(1);

        // Preserve existing logs on restart
        let existing_logs = self
            .services
            .get(&key)
            .map(|s| s.logs.clone())
            .unwrap_or_default();
        let next_seq = existing_logs
            .last()
            .map(|l| l.seq.saturating_add(1))
            .unwrap_or(0);

        let managed = ManagedService {
            name: service_name.to_string(),
            project_name: project_name.to_string(),
            command: command.to_string(),
            status: ServiceStatus::Starting,
            logs: existing_logs,
            next_seq,
            original_port,
            env: env.cloned().unwrap_or_default(),
            allocated_port,
            port_pinned: pin == ports::PortPin::Strict,
            port_warning: None,
            pgid,
            alive: true,
            run_id,
            waiting_on: Vec::new(),
            stopping: Arc::clone(&stopping),
            port_watch: None,
        };

        self.services.insert(key.clone(), managed);

        let run = RunHandle::new(
            self.event_tx.clone(),
            key.clone(),
            run_id,
            Arc::clone(&stopping),
        );
        let settled = Arc::clone(&run.settled);
        let exited = Arc::clone(&run.exited);
        // A healthcheck is the only authority when configured; log lines are not.
        let log_pattern = healthcheck_url
            .is_none()
            .then(|| readiness.pattern.clone().unwrap_or_default());
        let probe = Probe::select(
            healthcheck_url,
            allocated_port,
            readiness.pattern.as_deref(),
        );
        spawn_readiness(run.clone(), readiness, probe);
        if allocated_port > 0 {
            let watch = spawn_port_watch(
                run.clone(),
                allocated_port,
                WatchTiming::DEFAULT,
                port_answers,
            );
            if let Some(svc) = self.services.get_mut(&key) {
                svc.port_watch = Some(watch);
            }
        }

        // Stream stdout
        if let Some(stdout) = stdout {
            let run = run.clone();
            let pattern = log_pattern.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if pattern
                        .as_deref()
                        .is_some_and(|p| line_indicates_ready(&line, p))
                    {
                        run.report_running();
                    }
                    run.announce(&line);
                    let _ = run.tx.send(ServiceEvent::Log {
                        key: run.key.clone(),
                        run_id: run.run_id,
                        line,
                    });
                }
            });
        }

        // Stream stderr — also check readyPattern here since many dev servers
        // (bun, vite, etc.) write their "ready" message to stderr, not stdout.
        if let Some(stderr) = stderr {
            let run = run.clone();
            let pattern = log_pattern.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if pattern
                        .as_deref()
                        .is_some_and(|p| line_indicates_ready(&line, p))
                    {
                        run.report_running();
                    }
                    run.announce(&line);
                    let _ = run.tx.send(ServiceEvent::Log {
                        key: run.key.clone(),
                        run_id: run.run_id,
                        line: format!("[err] {line}"),
                    });
                }
            });
        }

        // Exit waiter — actually detects the process ending (previously a no-op,
        // so a crashed service showed "running" forever). Reports Stopped for an
        // intentional stop, Failed for an unexpected exit.
        {
            let tx = self.event_tx.clone();
            let k = key.clone();
            let rid = run_id;
            let flag = Arc::clone(&stopping);
            tokio::spawn(async move {
                let result = child.wait().await;
                settled.store(true, Ordering::SeqCst);
                exited.store(true, Ordering::SeqCst);
                let exit_code = result.as_ref().ok().and_then(|s| s.code());
                let clean_exit = result.map(|s| s.success()).unwrap_or(false);
                let status = if flag.load(Ordering::SeqCst) || clean_exit {
                    ServiceStatus::Stopped
                } else {
                    ServiceStatus::Failed
                };
                let _ = tx.send(ServiceEvent::StatusChange {
                    key: k,
                    run_id: rid,
                    status,
                    exit_code,
                });
            });
        }
        Ok(())
    }

    /// Record a refused start (pinned port taken / outside range / range
    /// conflict) as a `Failed` service so the reason reaches the client the
    /// same way any other failure does: a status change plus a log marker.
    pub(super) fn record_start_failure(
        &mut self,
        key: &str,
        project_name: &str,
        service_name: &str,
        command: &str,
        message: String,
    ) {
        ports::release(project_name, service_name);
        let run_id = self.next_run_id;
        self.next_run_id = self.next_run_id.saturating_add(1);
        let existing_logs = self
            .services
            .get(key)
            .map(|s| s.logs.clone())
            .unwrap_or_default();
        let next_seq = existing_logs
            .last()
            .map(|l| l.seq.saturating_add(1))
            .unwrap_or(0);
        let mut managed = ManagedService {
            name: service_name.to_string(),
            project_name: project_name.to_string(),
            command: command.to_string(),
            status: ServiceStatus::Failed,
            logs: existing_logs,
            next_seq,
            original_port: 0,
            env: Default::default(),
            allocated_port: 0,
            port_pinned: false,
            port_warning: None,
            // An exited run's group stays reachable so the next start or stop reaps it.
            pgid: self.services.get(key).and_then(|s| s.pgid),
            alive: false,
            run_id,
            waiting_on: Vec::new(),
            stopping: Arc::new(AtomicBool::new(false)),
            port_watch: None,
        };
        managed.push_log(format!("[service failed] {message}"));
        self.services.insert(key.to_string(), managed);
        let _ = self.event_tx.send(ServiceEvent::StatusChange {
            key: key.to_string(),
            run_id,
            status: ServiceStatus::Failed,
            exit_code: None,
        });
    }
}
