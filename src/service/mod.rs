use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

mod deps;
mod port_watch;
mod query;
mod ready;
mod spawn;
mod stop;

#[cfg(test)]
pub(crate) mod tests;

pub use deps::{dependency_gate, DepState, Gate, PortClaim};
pub(crate) use port_watch::port_answers;
pub use port_watch::PortWarning;
pub use ready::Readiness;
pub use stop::kill_listeners_on_ports;

/// A single retained log line with a monotonic per-service sequence number and
/// the wall-clock time (epoch millis) it was captured. Sequence numbers let
/// clients read "everything after cursor X" cheaply and never lose/gain lines
/// as the ring buffer drops old entries; timestamps let tooling show age.
#[derive(Debug, Clone, PartialEq)]
pub struct LogLine {
    pub seq: u64,
    pub at_ms: u64,
    pub line: String,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum ServiceStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

impl std::fmt::Display for ServiceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServiceStatus::Starting => write!(f, "starting"),
            ServiceStatus::Running => write!(f, "running"),
            ServiceStatus::Stopped => write!(f, "stopped"),
            ServiceStatus::Failed => write!(f, "failed"),
        }
    }
}

#[allow(dead_code)]
pub struct ManagedService {
    pub name: String,
    pub project_name: String,
    pub command: String,
    pub status: ServiceStatus,
    pub logs: Vec<LogLine>,
    /// Sequence number for the next appended log line (monotonic, never reused,
    /// even across restarts). Log `seq` values are assigned from this.
    pub next_seq: u64,
    /// Port declared in .warpforge.yaml (0 = none)
    pub original_port: u16,
    env: HashMap<String, String>,
    /// Actual port the process is listening on (allocated from range)
    pub allocated_port: u16,
    /// True when the declared port was pinned strictly (no fallback).
    pub port_pinned: bool,
    /// Set while the allocated port stays silent although the service is up.
    pub port_warning: Option<PortWarning>,
    /// Process-group ID — used to kill the entire tree (sh → npm → node)
    pgid: Option<u32>,
    /// True from spawn until the run's exit is applied or the run is killed.
    /// A timed-out run is `Failed` while this is still true.
    alive: bool,
    /// Monotonic run identifier. Async log/status tasks include this so late
    /// events from an older process cannot overwrite a newer restart.
    run_id: u64,
    /// Dependencies held on before a process is spawned: set on a `Starting`
    /// placeholder, and kept on a `Failed` entry refused by a dependency so it
    /// can still start. Such an entry has no live process.
    pub waiting_on: Vec<String>,
    /// Set true when we're deliberately stopping, so the exit waiter can tell
    /// an intentional stop from a crash and report the right status.
    stopping: Arc<AtomicBool>,
    /// The allocated-port watcher of the live run; dropping it ends the watcher.
    port_watch: Option<port_watch::WatchGuard>,
}

pub enum ServiceEvent {
    Log {
        key: String,
        run_id: u64,
        line: String,
    },
    StatusChange {
        key: String,
        run_id: u64,
        status: ServiceStatus,
        /// Exit code from a stopped/crashed process, when known (None for a
        /// signal kill). Drives the `[service failed: exit code=N]` marker.
        exit_code: Option<i32>,
    },
    /// The run's ready timeout elapsed; the process is left running.
    NotReady {
        key: String,
        run_id: u64,
        reason: String,
    },
    /// Result of one probe of the allocated port; `listening` are the announced
    /// ports that answered.
    PortProbe {
        key: String,
        run_id: u64,
        answered: bool,
        listening: Vec<u16>,
    },
    /// A run that timed out became ready after all, `after` its spawn.
    LateReady {
        key: String,
        run_id: u64,
        after: std::time::Duration,
    },
}

pub struct ServiceManager {
    services: HashMap<String, ManagedService>,
    pub event_tx: mpsc::UnboundedSender<ServiceEvent>,
    next_run_id: u64,
}

impl ManagedService {
    pub(crate) fn needs_restart(&self, definition: &crate::config::ServiceConfig) -> bool {
        self.alive
            && (self.command != definition.command
                || self.original_port != definition.port.unwrap_or(0)
                || match &definition.env {
                    Some(env) => &self.env != env,
                    None => !self.env.is_empty(),
                })
    }

    /// Whether this entry's last run may still be running, whatever its status.
    pub fn process_alive(&self) -> bool {
        self.alive
    }

    /// Append a retained line (assigning its seq + timestamp) and trim the ring.
    pub fn push_log(&mut self, line: String) {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        self.logs.push(LogLine {
            seq,
            at_ms: now_ms(),
            line,
        });
        if self.logs.len() > 2000 {
            self.logs.drain(..self.logs.len() - 2000);
        }
    }

    /// Slice the ring by seq cursor and cap to `limit`; returns raw lines, their
    /// timestamps (millis, index-aligned), and the cursor to pass back as `after`.
    /// `after` is inclusive ("start from this seq"), so `0` returns the oldest
    /// retained line and polling with the returned cursor returns only newer ones.
    pub fn window(&self, after: u64, limit: Option<u32>) -> (Vec<String>, Vec<u64>, u64) {
        let mut lines: Vec<&LogLine> = self.logs.iter().filter(|l| l.seq >= after).collect();
        if let Some(n) = limit {
            let n = n as usize;
            if lines.len() > n {
                lines = lines.split_off(lines.len() - n);
            }
        }
        let (text, at): (Vec<String>, Vec<u64>) =
            lines.iter().map(|l| (l.line.clone(), l.at_ms)).unzip();
        (text, at, self.next_seq)
    }
}

#[allow(dead_code)]
impl ServiceManager {
    pub fn new(event_tx: mpsc::UnboundedSender<ServiceEvent>) -> Self {
        Self {
            services: HashMap::new(),
            event_tx,
            next_run_id: 1,
        }
    }
}
