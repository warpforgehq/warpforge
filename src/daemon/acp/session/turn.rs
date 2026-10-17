use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::json;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::daemon::acp::model::parse_config_options;
use crate::daemon::acp::process::acp_error_detail;
use crate::daemon::acp::prompt::{send_prompt, Turn};
use crate::daemon::acp::rpc::rpc;
use crate::daemon::acp::{AcpCommand, AcpUpdate, TurnInitiator};
use crate::daemon::prompt::PreparedPrompt;
use warpforge_protocol as wire;

use super::init::Initialized;
use super::{permissions, Session};

/// How long a cancelled turn gets to answer its own `session/prompt` before the
/// driver stops waiting and dispatches the queue anyway. Without a bound an
/// agent that ignores `session/cancel` would swallow every queued message.
const INTERRUPT_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

/// The refusal for an edit/remove that lost a race with the queue draining.
/// The client shows it as "Already sent": the message is no longer a queue
/// entry, so there is nothing left to change.
const GONE_ALREADY_SENT: &str = "that message was already sent";

/// The refusal for editing a message someone else queued: its text is what
/// the feed and the sender recorded.
const NOT_YOURS: &str = "only your own messages can be edited";

/// The single outstanding turn.
struct Active {
    handle: JoinHandle<()>,
    initiator: TurnInitiator,
    interrupted: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
}

/// A submitted prompt the agent has not been given yet.
struct Queued {
    id: String,
    prompt: PreparedPrompt,
    initiator: TurnInitiator,
}

impl Queued {
    fn to_wire(&self) -> wire::QueuedPrompt {
        wire::QueuedPrompt {
            id: self.id.clone(),
            text: self.prompt.text.clone(),
            initiator: match self.initiator {
                TurnInitiator::Automation => "automation",
                TurnInitiator::User | TurnInitiator::Initial => "user",
                TurnInitiator::System => "system",
                TurnInitiator::Peer => "peer",
            }
            .into(),
            peer_message_id: self.prompt.peer.direct,
            attachments: self.prompt.summaries.clone(),
        }
    }
}

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
    let mut active: Option<Active> = None;
    let mut queued: VecDeque<Queued> = VecDeque::new();
    // The user's queued messages, taken out of the queue by a force-send and
    // sent as one turn. They still count as waiting until that turn starts.
    let mut batched: Vec<Queued> = Vec::new();
    let mut next_id = 0u64;
    let mut deadline: Option<tokio::time::Instant> = None;
    let mut exit_watch = session.exit_rx.clone();

    let update = |update: AcpUpdate| {
        let _ = session.updates.send((session.task_id.clone(), update));
    };

    let dispatch = |prompt: PreparedPrompt, initiator: TurnInitiator| {
        let interrupted = Arc::new(AtomicBool::new(false));
        let ended = Arc::new(AtomicBool::new(false));
        Active {
            handle: send_prompt(
                &session.out_tx,
                &session.pending,
                &session.next_id,
                &session.updates,
                &session.task_id,
                &session_id,
                Turn {
                    prompt,
                    initiator,
                    interrupted: Arc::clone(&interrupted),
                    ended: Arc::clone(&ended),
                },
                embedded_context,
                session.exit_rx.clone(),
                session.reporter.clone(),
                session.kill_tx.clone(),
                agent_name,
            ),
            initiator,
            interrupted,
            ended,
        }
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
        active = Some(dispatch(
            session.initial_prompt.clone(),
            TurnInitiator::Initial,
        ));
    }

    let mut announced: Vec<wire::QueuedPrompt> = Vec::new();
    loop {
        // A finished turn frees the slot: send the force-sent batch if there is
        // one, otherwise the oldest queued prompt.
        if active.is_none() {
            deadline = None;
            if !batched.is_empty() {
                let parts = std::mem::take(&mut batched);
                let prompt = PreparedPrompt::merge(parts.into_iter().map(|entry| entry.prompt));
                active = Some(dispatch(prompt, TurnInitiator::User));
            } else if let Some(entry) = queued.pop_front() {
                active = Some(dispatch(entry.prompt, entry.initiator));
            }
        }
        // The batch is still waiting until its turn starts, so it stays on the
        // list: a message that left the queue without reaching the chat is one
        // the user cannot see anywhere.
        let waiting: Vec<wire::QueuedPrompt> = batched
            .iter()
            .chain(queued.iter())
            .map(Queued::to_wire)
            .collect();
        if waiting != announced {
            announced = waiting.clone();
            update(AcpUpdate::QueueChanged { queued: waiting });
        }
        let wake = deadline;

        tokio::select! {
            cmd = cmd_rx.recv() => match cmd {
                Some(AcpCommand::Prompt { prompt, initiator }) => {
                    if active.is_some() {
                        next_id += 1;
                        queued.push_back(Queued {
                            id: format!("q{next_id}"),
                            prompt,
                            initiator,
                        });
                    } else {
                        active = Some(dispatch(prompt, initiator));
                    }
                }
                // Force-send: end the running turn deliberately and hand the
                // agent what the user had waiting, as one turn. The turn's own
                // send task reports it as interrupted, so its partial text is
                // never mistaken for a result.
                //
                // Nothing waiting means nothing to force through, and a turn is
                // not cut short for that: the click lost a race with the queue
                // draining, and killing the turn would kill the very message it
                // was meant to hurry along.
                Some(AcpCommand::Interrupt { reply }) => {
                    // Only the user's messages are forced through, so a queue
                    // holding none is nothing to cut the turn short for.
                    let nothing_waiting = batched.is_empty()
                        && !queued.iter().any(|entry| entry.initiator == TurnInitiator::User);
                    let verdict = match (nothing_waiting, active.as_ref()) {
                        (false, Some(running)) => {
                            // Only the user's own messages fold into one
                            // prompt: an initiator decides whose answer the
                            // turn is, so the rest keep their place in line.
                            let (mine, rest): (Vec<_>, Vec<_>) =
                                std::mem::take(&mut queued)
                                    .into_iter()
                                    .partition(|entry| {
                                        entry.initiator == TurnInitiator::User
                                    });
                            queued = rest.into();
                            // A second force-send inside the grace window adds
                            // to the batch; replacing it would drop the very
                            // messages the first one was sent to hurry along.
                            batched.extend(mine);
                            running.interrupted.store(true, Ordering::Release);
                            let _ = session.out_tx.send(
                                json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session_id}}).to_string(),
                            );
                            deadline = Some(tokio::time::Instant::now() + INTERRUPT_GRACE);
                            Ok(())
                        }
                        _ => Err("nothing is waiting to be sent".to_string()),
                    };
                    let _ = reply.send(verdict);
                }
                // Drop or rewrite one message that is still waiting. A
                // force-sent batch counts as waiting until its turn starts, so
                // it can be edited too; once dispatched, the entry is gone and
                // the refusal tells the client it was already sent.
                Some(AcpCommand::RemoveQueued { id, reply }) => {
                    let verdict = match take_queued(&mut batched, &mut queued, &id) {
                        Some(_) => Ok(()),
                        None => Err(GONE_ALREADY_SENT.into()),
                    };
                    let _ = reply.send(verdict);
                }
                Some(AcpCommand::EditQueued { id, text, reply }) => {
                    let verdict = match find_queued(&mut batched, &mut queued, &id) {
                        Some(entry) if entry.initiator == TurnInitiator::User => {
                            entry.prompt.set_text(text);
                            Ok(())
                        }
                        Some(_) => Err(NOT_YOURS.into()),
                        None => Err(GONE_ALREADY_SENT.into()),
                    };
                    let _ = reply.send(verdict);
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
                                "agent rejected '{config_id}': {}",
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
                    Some(running) => {
                        let _ = (&mut running.handle).await;
                    }
                    None => std::future::pending::<()>().await,
                }
            } => {
                active = None;
            },
            // The cancelled turn never answered. Drop it and move the queue on
            // — the turn is over either way, so report it as ended ourselves,
            // unless its send task claimed that right first.
            _ = async {
                match wake {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                if let Some(running) = active.take() {
                    running.handle.abort();
                    if !running.ended.swap(true, Ordering::AcqRel) {
                        update(AcpUpdate::TurnEnded {
                            stop_reason: "cancelled".into(),
                            initiator: running.initiator,
                            interrupted: true,
                        });
                    }
                }
            },
            // The child is gone: no queued follow-up can run, and the monitor
            // reports the exit on its own. Drop the queue and stop driving.
            _ = exit_watch.changed() => {
                break;
            }
        }
    }
    if !announced.is_empty() {
        update(AcpUpdate::QueueChanged { queued: Vec::new() });
    }
}

/// Borrow one waiting entry by id. A force-sent batch is still waiting, so it
/// is searched too; the queue proper holds the rest.
fn find_queued<'a>(
    batched: &'a mut [Queued],
    queued: &'a mut VecDeque<Queued>,
    id: &str,
) -> Option<&'a mut Queued> {
    if let Some(entry) = batched.iter_mut().find(|entry| entry.id == id) {
        return Some(entry);
    }
    queued.iter_mut().find(|entry| entry.id == id)
}

/// Remove and hand back one waiting entry by id, from wherever it waits.
fn take_queued(
    batched: &mut Vec<Queued>,
    queued: &mut VecDeque<Queued>,
    id: &str,
) -> Option<Queued> {
    if let Some(index) = batched.iter().position(|entry| entry.id == id) {
        return Some(batched.remove(index));
    }
    if let Some(index) = queued.iter().position(|entry| entry.id == id) {
        return queued.remove(index);
    }
    None
}
