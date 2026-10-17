//! Opening a consultation: the guards, the transcript digest, and handing
//! the question to the advisor's session.

use std::time::Duration;

use tokio::sync::oneshot;

use super::prompt::{consultation_prompt, digest, Digest};
use super::{
    AdvisorTicket, Consultation, ADVISOR_ORIGIN, DEADLINE, MAX_QUESTIONS_PER_TURN, SHORT_WAIT,
};
use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::{Command, Daemon, Event};
use crate::daemon::task::{Task, TaskStatus};

const GIT_STATUS_TIMEOUT: Duration = Duration::from_secs(10);

impl Daemon {
    pub(super) fn advisor_ask(
        &mut self,
        task_id: &str,
        question: String,
        context: Option<String>,
    ) -> Result<AdvisorTicket, String> {
        let Some(advisor) = self.tasks.get(task_id).and_then(|t| t.advisor.clone()) else {
            return Err("This task has no advisor.".into());
        };
        if question.trim().is_empty() {
            return Err("Ask a question: `question` is empty.".into());
        }
        let state = self.advisors.states.entry(task_id.to_string()).or_default();
        if state.pending.is_some() {
            return Err(
                "The advisor is still answering your previous question. Call \
                        ask_advisor with wait: true to keep waiting for that answer."
                    .into(),
            );
        }
        if state.turn_questions >= MAX_QUESTIONS_PER_TURN {
            return Err(format!(
                "You have asked the advisor {MAX_QUESTIONS_PER_TURN} questions this turn, \
                 the most one turn allows. Decide with what you have, or ask the user."
            ));
        }
        let account = self.spawn_account(advisor.task_id.as_deref().unwrap_or_default());
        if let Some(reason) = self.dispatch_refusal(&advisor.agent, account) {
            return Err(format!("The advisor cannot start: {reason}."));
        }
        self.advisors.next_id += 1;
        let id = self.advisors.next_id;
        let wait = self.advisor_wait_window(task_id);
        let state = self.advisors.states.entry(task_id.to_string()).or_default();
        state.turn_questions += 1;
        state.unread = None;
        state.pending = Some(Consultation {
            id,
            question,
            context,
            baseline_cost: state.running_cost,
            dispatched: false,
            started: false,
        });
        let (tx, rx) = oneshot::channel();
        state.waiters.push(tx);
        self.gather_advisor_context(task_id, id);
        let cmd_tx = self.cmd_tx.clone();
        let executor = task_id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(DEADLINE).await;
            let _ = cmd_tx
                .send(Command::AdvisorDeadline {
                    executor,
                    consultation: id,
                })
                .await;
        });
        Ok(AdvisorTicket::Waiting { answer: rx, wait })
    }

    pub(super) fn advisor_wait(&mut self, task_id: &str) -> Result<AdvisorTicket, String> {
        let wait = self.advisor_wait_window(task_id);
        let Some(state) = self.advisors.states.get_mut(task_id) else {
            return Err(NOTHING_PENDING.into());
        };
        if let Some(answer) = state.unread.take() {
            return Ok(AdvisorTicket::Ready(answer));
        }
        if state.pending.is_none() {
            return Err(NOTHING_PENDING.into());
        }
        let (tx, rx) = oneshot::channel();
        state.waiters.push(tx);
        Ok(AdvisorTicket::Waiting { answer: rx, wait })
    }

    /// Claude Code waits on an MCP call as long as it takes; other harnesses
    /// time the call out, so they wait in windows and call again.
    fn advisor_wait_window(&self, executor: &str) -> Duration {
        let agent = self
            .tasks
            .get(executor)
            .map_or("", |task| task.agent.as_str());
        if self.agent_id_of(agent) == "claude" {
            DEADLINE + Duration::from_secs(30)
        } else {
            SHORT_WAIT
        }
    }

    /// Read the executor's transcript and the checkout's status off the loop.
    fn gather_advisor_context(&self, executor: &str, consultation: u64) {
        let persist = self.persist.clone();
        let store = self.store.clone();
        let cmd_tx = self.cmd_tx.clone();
        let cwd = self.task_repo_path(executor);
        let executor = executor.to_string();
        tokio::spawn(async move {
            persist.flush().await;
            let lookup = executor.clone();
            let updates = crate::daemon::runtime::store_read(store, move |store| {
                store.load_session_updates(&lookup).unwrap_or_default()
            })
            .await
            .unwrap_or_default();
            let status = match cwd {
                Some(cwd) => git_status(&cwd).await,
                None => String::new(),
            };
            let _ = cmd_tx
                .send(Command::AdvisorContextReady {
                    executor,
                    consultation,
                    digest: digest(&updates, &status),
                })
                .await;
        });
    }

    pub(super) fn advisor_context_ready(&mut self, executor: &str, id: u64, digest: Digest) {
        let Some(pending) = self
            .advisors
            .states
            .get(executor)
            .and_then(|state| state.pending.as_ref())
            .filter(|pending| pending.id == id)
        else {
            return;
        };
        let (question, context) = (pending.question.clone(), pending.context.clone());
        let Some(task) = self.tasks.get(executor) else {
            return;
        };
        let Some(advisor) = task.advisor.clone() else {
            return;
        };
        let live = advisor
            .task_id
            .clone()
            .filter(|child| self.tasks.contains_key(child));
        let delivered = match live {
            Some(child) => {
                let text = consultation_prompt(None, &digest, &question, context.as_deref());
                self.prompt_advisor(executor, id, child, text);
                Ok(())
            }
            None => {
                let goal = Some((task.title.as_str(), task.prompt.as_str()));
                let text = consultation_prompt(goal, &digest, &question, context.as_deref());
                self.start_advisor(executor, &advisor, text)
            }
        };
        match delivered {
            Ok(()) => {
                if let Some(pending) = self
                    .advisors
                    .states
                    .get_mut(executor)
                    .and_then(|state| state.pending.as_mut())
                {
                    pending.dispatched = true;
                }
            }
            Err(error) => self.finish_consultation(executor, Err(error)),
        }
    }

    fn start_advisor(
        &mut self,
        executor: &str,
        advisor: &warpforge_protocol::TaskAdvisor,
        text: String,
    ) -> Result<(), String> {
        let Some(parent) = self.tasks.get(executor) else {
            return Err("the task is gone".into());
        };
        let project = parent.project.clone();
        let title = match parent.title.trim() {
            "" => "Advisor".to_string(),
            title => format!("Advisor · {title}"),
        };
        let mut task = Task::new(&project, &text, &advisor.agent, vec![ADVISOR_ORIGIN.into()]);
        task.title = title;
        task.parent_task_id = Some(executor.to_string());
        task.origin = Some(ADVISOR_ORIGIN.to_string());
        task.model = advisor.model.clone();
        let child = task.id.clone();
        self.tasks.insert(child.clone(), task.clone());
        self.persist(&task);
        self.emit(Event::TaskCreated(task));
        if let Some(parent) = self.tasks.get_mut(executor) {
            if let Some(advisor) = parent.advisor.as_mut() {
                advisor.task_id = Some(child.clone());
            }
            let updated = parent.clone();
            self.persist(&updated);
            self.emit(Event::TaskUpdated(updated));
        }
        self.start_session(
            &child,
            &project,
            &advisor.agent,
            &text,
            false,
            None,
            Vec::new(),
            advisor.model.clone(),
            std::collections::HashMap::new(),
        );
        if self.sessions.contains_key(&child) {
            return Ok(());
        }
        Err(self
            .tasks
            .get(&child)
            .and_then(|task| task.blocked_reason.clone())
            .unwrap_or_else(|| "the advisor's agent did not start".into()))
    }

    /// Through `SessionPrompt`, so a lost session resumes the way a person's
    /// message would resume it.
    fn prompt_advisor(&self, executor: &str, consultation: u64, child: String, text: String) {
        let cmd_tx = self.cmd_tx.clone();
        let executor = executor.to_string();
        tokio::spawn(async move {
            let (reply, answer) = oneshot::channel();
            let sent = cmd_tx
                .send(Command::SessionPrompt {
                    task_id: child,
                    text,
                    attachments: Vec::new(),
                    initiator: TurnInitiator::System,
                    peer_message: None,
                    reply,
                })
                .await;
            let error = match (sent, answer.await) {
                (Ok(()), Ok(Ok(()))) => return,
                (_, Ok(Err(error))) => error,
                _ => "the daemon is shutting down".to_string(),
            };
            let _ = cmd_tx
                .send(Command::AdvisorUndelivered {
                    executor,
                    consultation,
                    error: format!("the advisor could not be reached: {error}"),
                })
                .await;
        });
    }

    /// Fail the consultation and stop the advisor, so a late answer cannot be
    /// taken for the next question's. Its saved session resumes on that one.
    pub(super) fn advisor_deadline(&mut self, executor: &str, consultation: u64) {
        if !self.is_pending(executor, consultation) {
            return;
        }
        let child = self
            .tasks
            .get(executor)
            .and_then(|task| task.advisor.as_ref()?.task_id.clone());
        if let Some(child) = child {
            if let Some(handle) = self.sessions.remove(&child) {
                handle.cancel();
            }
            if let Some(task) = self.tasks.get_mut(&child) {
                task.set_status(TaskStatus::Interrupted);
                let updated = task.clone();
                self.persist(&updated);
                self.emit(Event::TaskUpdated(updated));
            }
        }
        self.finish_consultation(
            executor,
            Err(format!(
                "the advisor did not answer within {} minutes",
                DEADLINE.as_secs() / 60
            )),
        );
    }
}

const NOTHING_PENDING: &str = "No advisor question is pending. Ask one with ask_advisor(question).";

async fn git_status(cwd: &str) -> String {
    let status = tokio::process::Command::new("git")
        .args(["status", "--short", "--untracked-files=all"])
        .current_dir(cwd)
        .output();
    match tokio::time::timeout(GIT_STATUS_TIMEOUT, status).await {
        Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
        _ => String::new(),
    }
}
