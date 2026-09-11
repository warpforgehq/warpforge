use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use serde_json::json;
use tokio::sync::{mpsc, watch};

use super::process::{acp_error_detail, ChildState, FailureReporter};
use super::rpc::{rpc_with_exit, Pending, RpcOutcome};
use super::AcpUpdate;
use crate::daemon::prompt::PreparedPrompt;

/// Send a `session/prompt` in the background and emit a TurnEnded when it
/// resolves — prompts don't block the command loop.
#[allow(clippy::too_many_arguments)]
pub(super) fn send_prompt(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Pending,
    next_id: &Arc<AtomicU64>,
    updates: &mpsc::UnboundedSender<(String, AcpUpdate)>,
    task_id: &str,
    session_id: &str,
    prompt: PreparedPrompt,
    embedded_context: bool,
    mut exit_rx: watch::Receiver<ChildState>,
    reporter: FailureReporter,
    kill_tx: mpsc::UnboundedSender<()>,
    agent_name: &str,
) {
    let out_tx = out_tx.clone();
    let pending = Arc::clone(pending);
    let next_id = Arc::clone(next_id);
    let updates = updates.clone();
    let task_id = task_id.to_string();
    let session_id = session_id.to_string();
    let agent_name = agent_name.to_string();
    tokio::spawn(async move {
        let res = rpc_with_exit(
            &out_tx,
            &pending,
            &next_id,
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": prompt.content.iter().map(|block| block.to_acp(embedded_context)).collect::<Vec<_>>()
            }),
            &mut exit_rx,
        )
        .await;
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
        let _ = updates.send((task_id, AcpUpdate::TurnEnded { stop_reason: stop }));
    });
}
