//! Installing/updating an agent and proving it starts: the overall budget, the
//! one automatic repair for a broken install, and the per-agent in-flight guard.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::super::antigravity;
use super::super::detect::{package_manager_for_path, which};
use super::super::known_agent;
use super::run::run_manage_command_with_timeout;
use super::{
    broken_install, broken_install_summary, can_reinstall, clean_install_command, install_command,
    update_command, ANTIGRAVITY,
};
use crate::daemon::accounts::AgentEnv;

/// Overall budget for an install/update, its verification and one repair. Kept
/// under the client's slow-request timeout so the UI never times out first and
/// lets a second install start.
const INSTALL_DEADLINE: Duration = Duration::from_secs(12 * 60);
/// Minimum budget left for a repair to be worth starting.
const MIN_REPAIR_BUDGET: Duration = Duration::from_secs(3 * 60);
const REPAIR_SKIPPED: &str = "repair skipped: not enough time left in the install budget";

const PLATFORM_BINARY_SIGNATURES: &[&str] =
    &["missing optional dependency", "native binary not found"];

/// Whether a start failure is the platform-binary kind a clean reinstall fixes.
fn auto_repairable(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    PLATFORM_BINARY_SIGNATURES
        .iter()
        .any(|signature| lower.contains(signature))
}

/// A failure is auto-repaired only for a platform-binary broken install, on a
/// repairable agent, via the registry's own command — never a custom wrapper.
fn should_repair(clean: bool, is_default_command: bool, error: &str) -> bool {
    !clean && is_default_command && auto_repairable(error)
}

/// One install/update request. Grouped so the flow's signature stays small.
pub(crate) struct InstallRequest<'a> {
    pub id: &'a str,
    pub clean: bool,
    pub acp_command: &'a str,
    /// The verified command is the registry's default, not a user customization.
    pub is_default_command: bool,
    pub cwd: &'a Path,
    pub env: &'a AgentEnv,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum InstallError {
    /// Another install for the same agent is already running.
    InFlight,
    /// No automated install/update exists for this agent.
    NoCommand,
}

/// The result of an install/update: whether the agent was proven to start, and
/// whether a start failure was a repairable broken install.
#[derive(Debug)]
pub(crate) struct ManageOutcome {
    pub ok: bool,
    pub command: String,
    pub output: String,
    /// The agent completed the ACP handshake after installing.
    pub verified: bool,
    pub verify_error: Option<String>,
    pub broken_install: bool,
    pub summary: Option<String>,
    pub repaired: bool,
}

/// A resolved install plan: the command to run and, when the install is
/// repairable, the clean reinstall that repairs a broken one.
#[derive(Clone)]
pub(crate) struct InstallPlan {
    pub command: String,
    pub clean_command: Option<String>,
}

/// The side effects [`install_agent`] needs, injectable so the install/repair
/// sequence is testable without running a package manager.
pub(crate) trait InstallOps {
    async fn plan(&self, id: &str, clean: bool) -> Option<InstallPlan>;
    async fn run(&self, command: &str, limit: Duration) -> (bool, String);
    async fn verify(&self, acp_command: &str, cwd: &Path, env: &AgentEnv) -> Result<(), String>;
}

struct RealInstallOps;

impl InstallOps for RealInstallOps {
    async fn plan(&self, id: &str, clean: bool) -> Option<InstallPlan> {
        let agent = known_agent(id)?;
        let path = which(agent.binary).await;
        if agent.id == ANTIGRAVITY {
            if clean || path.as_deref().is_some_and(|p| !antigravity::is_managed(p)) {
                return None;
            }
            let manifest = antigravity::fetch_manifest().await?;
            return Some(InstallPlan {
                command: antigravity::install_script(&manifest)?,
                clean_command: None,
            });
        }
        let manager = path.as_deref().map(package_manager_for_path);
        let clean_command = can_reinstall(manager, agent.npm_package)
            .then(|| clean_install_command(agent))
            .flatten();
        let command = if clean {
            clean_command.clone()?
        } else {
            match path.as_deref() {
                Some(path) => update_command(agent, Some(path))?,
                None => install_command(agent)?,
            }
        };
        Some(InstallPlan {
            command,
            clean_command,
        })
    }

    async fn run(&self, command: &str, limit: Duration) -> (bool, String) {
        run_manage_command_with_timeout(command, limit).await
    }

    async fn verify(&self, acp_command: &str, cwd: &Path, env: &AgentEnv) -> Result<(), String> {
        verify_agent(acp_command, cwd, env).await
    }
}

/// Install or update an agent, then verify it starts. A platform-binary broken
/// install (when repairable) triggers one clean reinstall; `clean` skips
/// straight to the removal + reinstall.
pub(crate) async fn install_agent(
    request: InstallRequest<'_>,
) -> Result<ManageOutcome, InstallError> {
    install_agent_with(request, &RealInstallOps, INSTALL_DEADLINE).await
}

/// [`install_agent`] with an injected runner/probe and overall budget, so the
/// sequence and deadline can be tested.
pub(crate) async fn install_agent_with<O: InstallOps>(
    request: InstallRequest<'_>,
    ops: &O,
    budget: Duration,
) -> Result<ManageOutcome, InstallError> {
    let Some(_in_flight) = InFlightGuard::acquire(request.id) else {
        return Err(InstallError::InFlight);
    };
    let Some(plan) = ops.plan(request.id, request.clean).await else {
        return Err(InstallError::NoCommand);
    };
    let deadline = Instant::now() + budget;
    let (mut ok, mut output) = ops.run(&plan.command, remaining(deadline)).await;
    let mut repaired = false;
    let mut verified = false;
    let mut verify_error: Option<String> = None;

    if ok {
        match ops
            .verify(request.acp_command, request.cwd, request.env)
            .await
        {
            Ok(()) => verified = true,
            Err(error) => {
                verify_error = Some(error.clone());
                if should_repair(request.clean, request.is_default_command, &error) {
                    if let Some(repair) = plan.clean_command.clone() {
                        let left = remaining(deadline);
                        if left < MIN_REPAIR_BUDGET {
                            output.push_str(&format!("\n{REPAIR_SKIPPED}"));
                        } else {
                            let (repair_ok, repair_output) = ops.run(&repair, left).await;
                            repaired = true;
                            output.push_str(&format!("\n{repair}\n{repair_output}"));
                            if repair_ok {
                                match ops
                                    .verify(request.acp_command, request.cwd, request.env)
                                    .await
                                {
                                    Ok(()) => {
                                        verified = true;
                                        verify_error = None;
                                    }
                                    Err(error) => verify_error = Some(error),
                                }
                            } else {
                                ok = false;
                            }
                        }
                    }
                }
            }
        }
    }

    let broken = verify_error.as_deref().is_some_and(broken_install);
    let summary = verify_error.as_deref().and_then(broken_install_summary);
    Ok(ManageOutcome {
        ok,
        command: plan.command,
        output,
        verified,
        verify_error,
        broken_install: broken,
        summary,
        repaired,
    })
}

fn remaining(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now())
}

/// Run the ACP handshake the way a real session would, to prove the agent
/// starts rather than merely that a package manager exited zero.
async fn verify_agent(acp_command: &str, cwd: &Path, env: &AgentEnv) -> Result<(), String> {
    crate::daemon::agent_probe::probe_models(acp_command, cwd, &env.set, &env.remove)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

static IN_FLIGHT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Rejects a second install for an agent while the first is still running, so
/// a client timeout cannot start a competing uninstall/reinstall.
struct InFlightGuard {
    id: String,
}

impl InFlightGuard {
    fn acquire(id: &str) -> Option<Self> {
        let mut guard = IN_FLIGHT.lock().unwrap();
        let set = guard.get_or_insert_with(HashSet::new);
        set.insert(id.to_string())
            .then(|| Self { id: id.to_string() })
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        if let Some(set) = IN_FLIGHT.lock().unwrap().as_mut() {
            set.remove(&self.id);
        }
    }
}

#[cfg(test)]
mod tests;
