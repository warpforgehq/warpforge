use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot, watch};

use super::process::{ChildState, ProcessGuard, STOP_GRACE};
use super::AcpCommand;
use crate::daemon::prompt::PreparedPrompt;

/// Handle the actor keeps per task to drive its agent session.
#[derive(Clone)]
pub struct AcpHandle {
    pub(super) cmd_tx: mpsc::UnboundedSender<AcpCommand>,
    pub(super) exit_rx: watch::Receiver<ChildState>,
    pub(super) image_capability: Arc<AtomicU8>,
    pub(super) process: Arc<ProcessGuard>,
    pub(super) run_id: u64,
}

impl AcpHandle {
    pub fn prompt(&self, prompt: PreparedPrompt) -> Result<(), String> {
        if prompt.has_images && self.image_capability.load(Ordering::Acquire) != 2 {
            return Err("this agent does not support image prompts".into());
        }
        self.cmd_tx
            .send(AcpCommand::Prompt(prompt))
            .map_err(|_| "agent session is no longer running".into())
    }
    pub fn answer(&self, request_id: String, outcome: String) {
        let _ = self.cmd_tx.send(AcpCommand::AnswerPermission {
            request_id,
            outcome,
        });
    }
    /// Change a selector and wait for the agent to confirm. `Err` means the
    /// agent rejected it, went away, or never answered — the caller is expected
    /// to tell the user rather than leave a stale selection on screen.
    pub async fn set_config_option(&self, config_id: String, value: String) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        if self
            .cmd_tx
            .send(AcpCommand::SetConfigOption {
                config_id,
                value,
                reply: tx,
            })
            .is_err()
        {
            return Err("agent session is no longer running".into());
        }
        rx.await
            .unwrap_or_else(|_| Err("agent session is no longer running".into()))
    }
    pub fn cancel(&self) {
        self.process.stop_intentionally();
        let _ = self.cmd_tx.send(AcpCommand::Cancel);
    }

    /// Request cancellation and wait until the process monitor has reaped the
    /// ACP child. Callers can use this as the acknowledgement boundary for a
    /// hard-stop operation.
    pub async fn cancel_and_wait(&self) -> Result<(), String> {
        self.cancel();
        self.wait_for_exit_within(STOP_GRACE).await
    }

    /// False once the process monitor has reaped the ACP child. `prompt()` is
    /// NOT a liveness test — its channel belongs to the driver task, which
    /// outlives the child — so anything that must know whether an agent is
    /// still there has to ask this.
    pub fn is_alive(&self) -> bool {
        matches!(*self.exit_rx.borrow(), ChildState::Running)
    }

    /// Wait for the process monitor's post-`child.wait()` notification, giving
    /// up after `timeout`. The bound matters: callers await this inline in the
    /// daemon actor, so an unkillable child (D-state on a stuck mount) would
    /// otherwise freeze every project's RPCs and events, not just this task.
    pub async fn wait_for_exit_within(&self, timeout: std::time::Duration) -> Result<(), String> {
        match tokio::time::timeout(timeout, self.wait_for_exit()).await {
            Ok(result) => result,
            Err(_) => Err(format!(
                "agent process did not exit within {}s of being killed",
                timeout.as_secs()
            )),
        }
    }

    /// Wait for the process monitor's post-`child.wait()` notification.
    pub async fn wait_for_exit(&self) -> Result<(), String> {
        let mut exit_rx = self.exit_rx.clone();
        loop {
            if matches!(*exit_rx.borrow(), ChildState::Exited(_)) {
                return Ok(());
            }
            if exit_rx.changed().await.is_err() {
                return Err(
                    "ACP process monitor closed before confirming process termination".to_string(),
                );
            }
        }
    }

    pub fn run_id(&self) -> u64 {
        self.run_id
    }
}
