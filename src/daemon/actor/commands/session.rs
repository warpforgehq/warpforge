use warpforge_protocol as wire;

use crate::daemon::actor::PendingResume;
use crate::daemon::actor::PendingSessionStart;
use crate::daemon::actor::{Command, Daemon, Event};
use crate::daemon::task::Task;
use crate::daemon::task::TaskStatus;

impl Daemon {
    pub(crate) async fn handle_session_command(&mut self, cmd: Command) {
        match cmd {
            Command::ListSessions { project, reply } => {
                let path = self.project_path(&project);
                let agents = self.configured_agents.clone();
                tokio::task::spawn_blocking(move || {
                    let sessions = match path {
                        Some(p) => crate::daemon::sessions::external_sessions(&p, &agents),
                        None => Vec::new(),
                    };
                    let _ = reply.send(sessions);
                });
            }
            Command::ResumeTask {
                project,
                agent,
                session_id,
                title,
                reply,
            } => {
                let prompt = if title.is_empty() {
                    format!("Resumed {agent} session")
                } else {
                    title
                };
                let task = Task::new(&project, &prompt, &agent, vec!["resumed".into()]);
                let id = task.id.clone();
                // A freshly resumed external session carries no model intent
                // yet; threaded so the resume path reads the task, not a
                // hardcoded None.
                let default_model = task.model.clone();
                self.tasks.insert(id.clone(), task.clone());
                self.persist(&task);
                self.emit(Event::TaskCreated(task));
                let _ = reply.send(id.clone());
                // Load history only (empty prompt); user continues via session.prompt.
                self.start_session(
                    &id,
                    &project,
                    &agent,
                    "",
                    false,
                    Some(session_id),
                    vec![],
                    default_model,
                    std::collections::HashMap::new(),
                );
            }
            Command::SessionInterrupt { task_id, reply } => {
                // The verdict comes from the session driver, the only thing
                // that knows whether anything is queued. Off the loop, like
                // every other round-trip into a session.
                match self.sessions.get(&task_id).cloned() {
                    Some(handle) => {
                        tokio::spawn(async move {
                            let _ = reply.send(handle.interrupt().await);
                        });
                    }
                    None => {
                        let _ = reply.send(Err("this task has no running agent session".into()));
                    }
                }
            }
            Command::SessionRemoveQueued {
                task_id,
                queued_id,
                reply,
            } => {
                // The queue lives in the session driver, so it decides whether
                // that message is still waiting. Off the loop, like interrupt.
                match self.sessions.get(&task_id).cloned() {
                    Some(handle) => {
                        tokio::spawn(async move {
                            let _ = reply.send(handle.remove_queued(queued_id).await);
                        });
                    }
                    None => {
                        let _ = reply.send(Err("this task has no running agent session".into()));
                    }
                }
            }
            Command::SessionEditQueued {
                task_id,
                queued_id,
                text,
                reply,
            } => match self.sessions.get(&task_id).cloned() {
                Some(handle) => {
                    tokio::spawn(async move {
                        let _ = reply.send(handle.edit_queued(queued_id, text).await);
                    });
                }
                None => {
                    let _ = reply.send(Err("this task has no running agent session".into()));
                }
            },
            Command::SessionPrompt {
                task_id,
                text,
                attachments,
                initiator,
                reply,
            } => {
                let root = self.tasks.get(&task_id).map(|task| {
                    task.worktree
                        .clone()
                        .or_else(|| self.project_path(&task.project))
                        .unwrap_or_else(|| ".".into())
                });
                let prepared = root
                    .ok_or_else(|| format!("unknown task {task_id}"))
                    .and_then(|root| {
                        crate::daemon::prompt::prepare_prompt(
                            std::path::Path::new(&root),
                            text.clone(),
                            &attachments,
                        )
                    });
                let prepared = match prepared {
                    Ok(value) => value,
                    Err(error) => {
                        let _ = reply.send(Err(error));
                        return;
                    }
                };
                let live_delivery = self
                    .sessions
                    .get(&task_id)
                    .cloned()
                    .map(|handle| handle.prompt(prepared.clone(), initiator));
                match live_delivery {
                    Some(Ok(())) => {
                        // Neither the status nor the transcript moves here. A
                        // message sent mid-turn is queued, and the agent has
                        // not been told anything yet: `TurnStarted` marks the
                        // task Running and echoes the message, when it goes out.
                        let _ = reply.send(Ok(()));
                    }
                    Some(Err(_)) | None => {
                        // A closed command channel is a stale handle. Remove it
                        // before reconnecting so its last process guard can
                        // terminate/reap the old child.
                        self.sessions.remove(&task_id);
                        let resume = self.tasks.get(&task_id).and_then(|task| {
                            task.session_id.as_ref().map(|session_id| {
                                (
                                    task.project.clone(),
                                    task.agent.clone(),
                                    session_id.clone(),
                                    task.model.clone(),
                                )
                            })
                        });

                        if let Some((project, agent, session_id, default_model)) = resume {
                            self.mark_task_running(&task_id);
                            self.emit_session(
                                &task_id,
                                wire::SessionUpdate::AgentText {
                                    text: "Reconnecting to the saved agent session…".into(),
                                },
                            );
                            // The replay guard is built from the persisted
                            // transcript, which must be read off the loop
                            // (write-behind flush + store read). Start the
                            // session only once the guard has landed, mirroring
                            // WorktreeReady: starting before it would let the
                            // agent's replayed history through unfiltered and
                            // double the output.
                            self.pending_resume.insert(
                                task_id.clone(),
                                PendingResume {
                                    project,
                                    agent,
                                    text: text.clone(),
                                    session_id,
                                    attachments,
                                    default_model,
                                },
                            );
                            self.request_resume_replay_guard(&task_id);
                            let _ = reply.send(Ok(()));
                        } else if let Some(task) = self
                            .tasks
                            .get(&task_id)
                            .filter(|task| task.status == TaskStatus::Blocked)
                            .filter(|task| task.workflow_run.is_none())
                        {
                            // Retry a task blocked before its session existed (a
                            // failed checkout, say) from the stashed start, so the
                            // agent gets the task it never ran.
                            let fallback = PendingSessionStart {
                                project: task.project.clone(),
                                agent: task.agent.clone(),
                                prompt: task.prompt.clone(),
                                include_runtime_context: false,
                                attachments: Vec::new(),
                                default_model: task.model.clone(),
                                config_overrides: std::collections::HashMap::new(),
                            };
                            let start = self.blocked_starts.remove(&task_id).unwrap_or(fallback);
                            let prompt = combine_prompt(&start.prompt, &text);
                            self.start_session(
                                &task_id,
                                &start.project,
                                &start.agent,
                                &prompt,
                                start.include_runtime_context,
                                None,
                                start.attachments,
                                start.default_model,
                                start.config_overrides,
                            );
                            let _ = reply.send(Ok(()));
                        } else {
                            // Reject without echoing a user message that was never delivered.
                            let _ = reply.send(Err("no live or resumable agent session".into()));
                        }
                    }
                }
            }
            Command::SessionPermission {
                task_id,
                request_id,
                outcome,
                reply,
            } => {
                // First answer wins. A stale answer — a second tap, or a banner
                // answered after the in-app prompt — must not reach the agent
                // or rewrite the outcome the transcript already shows.
                match self
                    .pending_permissions
                    .resolve(&task_id, &request_id, &outcome)
                {
                    Ok(()) => {
                        let daemon_ask = self
                            .pending_permissions
                            .answer_daemon_ask(&request_id, &outcome);
                        if let Some(handle) = self.sessions.get(&task_id).filter(|_| !daemon_ask) {
                            handle.answer(request_id.clone(), outcome.clone());
                        }
                        self.emit_session(
                            &task_id,
                            wire::SessionUpdate::PermissionResolved {
                                request_id,
                                outcome,
                            },
                        );
                        let _ = reply.send(Ok(()));
                    }
                    Err(error) => {
                        let _ = reply.send(Err(error));
                    }
                }
            }
            Command::SessionSetConfigOption {
                task_id,
                config_id,
                value,
                reply,
            } => {
                let cmd_tx = self.cmd_tx.clone();
                match self.sessions.get(&task_id).cloned() {
                    Some(handle) => {
                        // The agent round-trip can take seconds; don't hold the
                        // actor loop hostage waiting for it. The verdict is
                        // routed back as a command so the actor can record it.
                        tokio::spawn(async move {
                            let result = handle
                                .set_config_option(config_id.clone(), value.clone())
                                .await;
                            let _ = reply.send(result.clone());
                            let _ = cmd_tx
                                .send(Command::SessionConfigOptionResult {
                                    task_id,
                                    config_id,
                                    value,
                                    result,
                                })
                                .await;
                        });
                    }
                    None => {
                        let _ = reply.send(Err(
                            "this task has no running agent session to configure".into(),
                        ));
                    }
                }
            }
            Command::SessionConfigOptionResult {
                task_id,
                config_id,
                value,
                result,
            } => {
                let is_model = self.tasks.get(&task_id).is_some_and(|task| {
                    task.config_options
                        .iter()
                        .find(|o| o.id == config_id)
                        .is_some_and(crate::daemon::acp::is_model_selector)
                });
                let Some(task) = self.tasks.get_mut(&task_id) else {
                    return;
                };
                match (&result, is_model) {
                    (Ok(()), true) => {
                        // The agent accepted the switch to the model selector:
                        // that is the task's durable model intent, and any
                        // earlier mismatch no longer describes reality.
                        if task.model.as_deref() != Some(value.as_str()) {
                            task.model = Some(value);
                        }
                        task.blocked_reason = None;
                        task.blocked_kind = None;
                        let updated = task.clone();
                        self.persist(&updated);
                        self.emit(Event::TaskUpdated(updated));
                    }
                    (Err(error), true) => {
                        // The user asked for a model and the agent said no (or
                        // never answered). Record it durably — the session
                        // keeps running on the old model, and the user must be
                        // able to see that later, not just in the toast.
                        task.blocked_reason =
                            Some(format!("Model '{value}' was not applied: {error}"));
                        task.blocked_kind = Some(wire::TaskBlockedKind::ModelMismatch);
                        let updated = task.clone();
                        self.persist(&updated);
                        self.emit(Event::TaskUpdated(updated));
                    }
                    _ => {}
                }
            }
            Command::AskUser {
                task_id,
                title,
                browser_origin,
                reply,
            } => self.ask_user(task_id, title, browser_origin, reply),
            Command::WithdrawAsk {
                task_id,
                request_id,
            } => self.withdraw_ask(task_id, request_id),
            Command::HtmlRenderPublish {
                task_id,
                render_id,
                title,
                height,
                reply,
            } => {
                let _ = reply.send(self.html_render_publish(&task_id, render_id, title, height));
            }

            other => self.handle_advisor_command(other).await,
        }
    }
}

/// The original task prompt, then the user's message, so a retried session has
/// the task it never started with.
fn combine_prompt(prompt: &str, message: &str) -> String {
    let prompt = prompt.trim();
    let message = message.trim();
    match (prompt.is_empty(), message.is_empty()) {
        (true, _) => message.to_string(),
        (_, true) => prompt.to_string(),
        _ => format!("{prompt}\n\n{message}"),
    }
}
