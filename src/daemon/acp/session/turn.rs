use std::collections::VecDeque;
use std::sync::Arc;

use serde_json::json;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::daemon::acp::model::parse_config_options;
use crate::daemon::acp::process::acp_error_detail;
use crate::daemon::acp::prompt::send_prompt;
use crate::daemon::acp::rpc::rpc;
use crate::daemon::acp::{AcpCommand, AcpUpdate};
use crate::daemon::prompt::PreparedPrompt;

use super::init::Initialized;
use super::{permissions, Session};

pub(super) async fn run(
    session: &Session,
    agent_name: &str,
    init: Initialized,
    cmd_rx: &mut mpsc::UnboundedReceiver<AcpCommand>,
) {
    const RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
    let Initialized {
        session_id,
        embedded_context,
        image_supported,
    } = init;

    // Exactly one `session/prompt` may be outstanding at a time. A real agent
    // treats the first reply as the end of the whole turn, so sending a second
    // prompt concurrently makes it end the first early and the driver emit a
    // spurious `TurnEnded` — which the actor reads as the task finishing. A
    // prompt that arrives mid-turn is queued and dispatched, in order, once the
    // active turn's send task completes.
    let mut active: Option<JoinHandle<()>> = None;
    let mut queued: VecDeque<PreparedPrompt> = VecDeque::new();
    let mut exit_watch = session.exit_rx.clone();

    let dispatch = |prompt: PreparedPrompt| {
        send_prompt(
            &session.out_tx,
            &session.pending,
            &session.next_id,
            &session.updates,
            &session.task_id,
            &session_id,
            prompt,
            embedded_context,
            session.exit_rx.clone(),
            session.reporter.clone(),
            session.kill_tx.clone(),
            agent_name,
        )
    };

    // On resume with no new instruction we only load history; the user
    // continues via session.prompt. Otherwise send the initial prompt.
    if !session.initial_prompt.content.is_empty() {
        if session.initial_prompt.has_images && !image_supported {
            session.reporter.report(format!(
                "Agent command '{agent_name}' does not support image prompts."
            ));
            let _ = session.kill_tx.send(());
            return;
        }
        active = Some(dispatch(session.initial_prompt.clone()));
    }

    loop {
        // A finished turn frees the slot: dispatch the oldest queued prompt.
        if active.is_none() {
            if let Some(prompt) = queued.pop_front() {
                active = Some(dispatch(prompt));
            }
        }

        tokio::select! {
            cmd = cmd_rx.recv() => match cmd {
                Some(AcpCommand::Prompt(prompt)) => {
                    if active.is_some() {
                        queued.push_back(prompt);
                    } else {
                        active = Some(dispatch(prompt));
                    }
                }
                Some(AcpCommand::AnswerPermission {
                    request_id,
                    outcome,
                }) => {
                    permissions::answer(session, request_id, outcome);
                }
                Some(AcpCommand::SetConfigOption {
                    config_id,
                    value,
                    reply,
                }) => {
                    let out_tx = session.out_tx.clone();
                    let pending = Arc::clone(&session.pending);
                    let next_id = Arc::clone(&session.next_id);
                    let updates = session.updates.clone();
                    let task_id = session.task_id.clone();
                    let session_id = session_id.clone();
                    tokio::spawn(async move {
                        let res = tokio::time::timeout(
                            RPC_TIMEOUT,
                            rpc(
                                &out_tx,
                                &pending,
                                &next_id,
                                "session/set_config_option",
                                json!({
                                    "sessionId": session_id, "configId": config_id, "value": value
                                }),
                            ),
                        )
                        .await;
                        let verdict = match res {
                            Ok(Some(resp)) if resp.get("error").is_none() => {
                                // The reply carries the full updated configOptions.
                                if let Some(result) = resp.get("result") {
                                    let opts = parse_config_options(result.get("configOptions"));
                                    if !opts.is_empty() {
                                        let _ = updates.send((
                                            task_id,
                                            AcpUpdate::ConfigOptions { options: opts },
                                        ));
                                    }
                                }
                                Ok(())
                            }
                            Ok(Some(resp)) => Err(format!(
                                "agent rejected '{config_id}'.{}",
                                acp_error_detail(&resp)
                            )),
                            Ok(None) => Err(format!(
                                "agent connection closed while setting '{config_id}'"
                            )),
                            Err(_) => Err(format!(
                                "agent did not answer within {}s while setting '{config_id}'",
                                RPC_TIMEOUT.as_secs()
                            )),
                        };
                        if let Err(ref message) = verdict {
                            eprintln!("[daemon] set_config_option: {message}");
                        }
                        let _ = reply.send(verdict);
                    });
                }
                // Cancel, or the handle dropping: stop the agent and drop every
                // queued follow-up. `stop_agent` is the interrupt; queued text
                // is deliberately not delivered.
                Some(AcpCommand::Cancel) | None => {
                    let _ = session.out_tx.send(
                        json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session_id}}).to_string(),
                    );
                    break;
                }
            },
            // The active turn's send task resolves on every outcome (reply,
            // transport close, process exit), so this frees the slot even when
            // the turn failed. `pending` when idle keeps the branch dormant.
            _ = async {
                match active.as_mut() {
                    Some(handle) => {
                        let _ = handle.await;
                    }
                    None => std::future::pending::<()>().await,
                }
            } => {
                active = None;
            },
            // The child is gone: no queued follow-up can run, and the monitor
            // reports the exit on its own. Drop the queue and stop driving.
            _ = exit_watch.changed() => {
                break;
            }
        }
    }
}
