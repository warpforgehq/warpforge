use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::json;
use tokio::sync::{mpsc, watch};

use super::process::{acp_error_detail, ChildState, FailureReporter};
use super::rpc::{begin_rpc, finish_rpc, wait_for_exit_with_grace, Pending, RpcOutcome};
use super::{AcpUpdate, TurnInitiator};
use crate::daemon::prompt::PreparedPrompt;

/// One dispatched turn: what to say, who asked for it, and the two flags the
/// driver shares with it — `interrupted` is raised when the driver cancels the
/// turn, `ended` is claimed by whoever reports the turn over.
pub(super) struct Turn {
    pub prompt: PreparedPrompt,
    pub initiator: TurnInitiator,
    pub interrupted: Arc<AtomicBool>,
    pub ended: Arc<AtomicBool>,
}

/// Write a `session/prompt` and await its reply in the background, emitting a
/// TurnEnded when it resolves. Returns the task's join handle; the turn loop
/// awaits it so only one `session/prompt` is ever outstanding per session (see
/// `turn::run`).
///
/// The request is on the wire before this returns. The driver may write
/// `session/cancel` the moment it does, and a cancel that overtook its own
/// prompt would leave the agent running a turn nobody can stop.
#[allow(clippy::too_many_arguments)]
pub(super) fn send_prompt(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Pending,
    next_id: &Arc<AtomicU64>,
    updates: &mpsc::UnboundedSender<(String, AcpUpdate)>,
    task_id: &str,
    session_id: &str,
    turn: Turn,
    embedded_context: bool,
    mut exit_rx: watch::Receiver<ChildState>,
    reporter: FailureReporter,
    kill_tx: mpsc::UnboundedSender<()>,
    agent_name: &str,
) -> tokio::task::JoinHandle<()> {
    let updates = updates.clone();
    let task_id = task_id.to_string();
    let agent_name = agent_name.to_string();
    let Turn {
        prompt,
        initiator,
        interrupted,
        ended,
    } = turn;
    let started = begin_rpc(
        out_tx,
        pending,
        next_id,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": prompt.content.iter().map(|block| block.to_acp(embedded_context)).collect::<Vec<_>>()
        }),
    );
    tokio::spawn(async move {
        let res = match started {
            Some(mut started) => finish_rpc(&mut started, &mut exit_rx).await,
            None => wait_for_exit_with_grace(&mut exit_rx).await,
        };
        let response = match res {
            RpcOutcome::Response(response) => response,
            RpcOutcome::Exited(_) => return,
            RpcOutcome::TransportClosed => {
                reporter.report(format!(
                    "Agent command '{agent_name}' closed its ACP stdout during session/prompt."
                ));
                let _ = kill_tx.send(());
                return;
            }
        };
        if response.get("error").is_some() {
            // Carry the agent's own words — without them this is the one failure
            // in the session that tells the user nothing at all.
            reporter.report(format!(
                "The agent rejected the ACP session/prompt request.{}",
                acp_error_detail(&response)
            ));
            let _ = kill_tx.send(());
            return;
        }
        let stop = Some(response)
            .and_then(|v| {
                v.get("result")?
                    .get("stopReason")?
                    .as_str()
                    .map(String::from)
            })
            .unwrap_or_else(|| "end_turn".into());
        // The driver reports the turn over itself once its cancel grace runs
        // out. Whichever gets here first is the only one that may say so.
        if ended.swap(true, Ordering::AcqRel) {
            return;
        }
        let interrupted = interrupted.load(Ordering::Acquire) || stop == "cancelled";
        let _ = updates.send((
            task_id,
            AcpUpdate::TurnEnded {
                stop_reason: stop,
                initiator,
                interrupted,
            },
        ));
    })
}
