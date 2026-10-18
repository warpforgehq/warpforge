//! Advisor mode (ADR 0022): a task's executor consults a second agent through
//! `ask_advisor`. The advisor is one hidden child task per executor, started
//! on the first question and continued on later ones, read-only throughout.

use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::daemon::actor::{Command, Daemon};
use crate::mcp::identity::BridgeMode;
use crate::policies::PolicyResult;

mod answer;
mod ask;
pub(crate) mod prompt;

/// `Task::origin` of an advisor's hidden task.
pub(crate) const ADVISOR_ORIGIN: &str = "advisor";

const MAX_QUESTIONS_PER_TURN: u32 = 3;

/// How long a consultation may take before it fails and the advisor's
/// session is stopped.
const DEADLINE: Duration = Duration::from_secs(15 * 60);

/// One `ask_advisor` call's wait for an executor whose harness gives MCP tool
/// calls a short timeout (Codex: 60s). The next call keeps waiting.
const SHORT_WAIT: Duration = Duration::from_secs(50);

/// What a consultation produced: the advice, or why there is none.
#[derive(Debug, Clone)]
pub(crate) struct AdvisorAnswer {
    pub(crate) answer: Result<String, String>,
    pub(crate) agent: String,
    pub(crate) model: Option<String>,
}

/// What `advisor.ask` and `advisor.wait` hand the RPC to wait on.
pub(crate) enum AdvisorTicket {
    Ready(AdvisorAnswer),
    Waiting {
        answer: oneshot::Receiver<AdvisorAnswer>,
        /// How long this call may wait before it reports `pending`.
        wait: Duration,
    },
}

/// Live consultation state, keyed by executor task. Never persisted: a daemon
/// restart ends every pending consultation along with the bridge call.
#[derive(Default)]
pub(crate) struct Advisors {
    states: HashMap<String, AdvisorState>,
    next_id: u64,
}

#[derive(Default)]
struct AdvisorState {
    turn_questions: u32,
    pending: Option<Consultation>,
    /// An answer whose waiter gave up before it came.
    unread: Option<AdvisorAnswer>,
    waiters: Vec<oneshot::Sender<AdvisorAnswer>>,
    /// The advisor session's latest reported running cost, in USD.
    running_cost: Option<f64>,
}

struct Consultation {
    id: u64,
    question: String,
    context: Option<String>,
    baseline_cost: Option<f64>,
    /// The prompt reached the advisor's session.
    dispatched: bool,
    /// The advisor's turn for it began; only its end is the answer.
    started: bool,
}

impl Daemon {
    pub(crate) async fn handle_advisor_command(&mut self, cmd: Command) {
        match cmd {
            Command::AdvisorAsk {
                task_id,
                question,
                context,
                reply,
            } => {
                let _ = reply.send(self.advisor_ask(&task_id, question, context));
            }
            Command::AdvisorWait { task_id, reply } => {
                let _ = reply.send(self.advisor_wait(&task_id));
            }
            Command::AdvisorContextReady {
                executor,
                consultation,
                digest,
            } => self.advisor_context_ready(&executor, consultation, digest),
            Command::AdvisorUndelivered {
                executor,
                consultation,
                error,
            } => {
                if self.is_pending(&executor, consultation) {
                    self.finish_consultation(&executor, Err(error));
                }
            }
            Command::AdvisorDeadline {
                executor,
                consultation,
            } => self.advisor_deadline(&executor, consultation),
            other => self.handle_accounts_command(other).await,
        }
    }

    /// The executor an advisor task advises, when `task_id` is one.
    pub(crate) fn advisor_executor_of(&self, task_id: &str) -> Option<String> {
        self.tasks
            .get(task_id)
            .filter(|task| task.origin.as_deref() == Some(ADVISOR_ORIGIN))
            .and_then(|task| task.parent_task_id.clone())
    }

    /// Which tool set the task's warpforge bridge serves.
    pub(crate) fn session_bridge_mode(&self, task_id: &str) -> BridgeMode {
        let Some(task) = self.tasks.get(task_id) else {
            return BridgeMode::Single;
        };
        if task.tags.iter().any(|tag| tag == "orchestrator-chat") {
            BridgeMode::Orchestrator
        } else if task.origin.as_deref() == Some(ADVISOR_ORIGIN) {
            BridgeMode::Advisor
        } else if task.origin.as_deref() == Some(crate::daemon::actor::smiths::SMITH_ORIGIN) {
            BridgeMode::Thread
        } else if task.smith.is_some() && task.advisor.is_none() {
            BridgeMode::Work
        } else if task.advisor.is_some() {
            BridgeMode::Advised
        } else {
            BridgeMode::Single
        }
    }

    /// An advisor works in its executor's checkout, without owning it: the
    /// advisor task records no worktree, so removing it never removes one.
    pub(crate) fn advisor_cwd(&self, task_id: &str) -> Option<String> {
        self.task_repo_path(&self.advisor_executor_of(task_id)?)
    }

    /// Add the harness's read-only session mode to an advisor's start, and a
    /// Smith thread's mode (`prompt::thread_mode`). Every start goes through
    /// here, a resume included.
    pub(crate) fn advisor_overrides(
        &self,
        task_id: &str,
        agent: &str,
        mut overrides: HashMap<String, String>,
    ) -> HashMap<String, String> {
        if !self.is_read_only_session(task_id) {
            return overrides;
        }
        let agent_id = self.agent_id_of(agent);
        let options = self
            .configured_agents
            .iter()
            .find(|candidate| candidate.id == agent_id)
            .map(|candidate| candidate.models.as_slice())
            .unwrap_or_default();
        let mode = if self.is_thread_task(task_id) {
            prompt::thread_mode(options)
        } else {
            prompt::read_only_mode(options)
        };
        if let Some((id, value)) = mode {
            overrides.insert(id, value);
        }
        overrides
    }

    /// A new executor turn gets a fresh question allowance; an advisor's turn
    /// starting marks the pending consultation as the one it answers.
    pub(crate) fn advisor_turn_started(&mut self, task_id: &str) {
        if let Some(state) = self.advisors.states.get_mut(task_id) {
            state.turn_questions = 0;
        }
        if let Some(executor) = self.advisor_executor_of(task_id) {
            if let Some(pending) = self
                .advisors
                .states
                .get_mut(&executor)
                .and_then(|state| state.pending.as_mut())
                .filter(|pending| pending.dispatched)
            {
                pending.started = true;
            }
        }
    }

    pub(crate) fn advisor_usage(&mut self, task_id: &str, cost: Option<&wire::SessionUsageCost>) {
        let Some(cost) = cost.filter(|cost| cost.currency == "USD") else {
            return;
        };
        if let Some(executor) = self.advisor_executor_of(task_id) {
            self.advisors
                .states
                .entry(executor)
                .or_default()
                .running_cost = Some(cost.amount);
        }
    }

    /// Answer a read-only session's permission request on the spot: denied,
    /// except a Smith thread's call to a warpforge tool its bridge serves.
    /// @param warpforge_tool the warpforge tool the request gates, if any
    /// @returns whether the request was a read-only session's and is answered
    pub(crate) fn advisor_answers_permission(
        &mut self,
        task_id: &str,
        request: wire::SessionUpdate,
        warpforge_tool: Option<String>,
    ) -> bool {
        if !self.is_read_only_session(task_id) {
            return false;
        }
        let wire::SessionUpdate::PermissionRequest { ref request_id, .. } = request else {
            return false;
        };
        let request_id = request_id.clone();
        let allowed = self.is_thread_task(task_id)
            && warpforge_tool
                .as_deref()
                .is_some_and(crate::mcp::thread_may_call);
        let outcome = if allowed { "allow" } else { "deny" };
        if let Some(handle) = self.sessions.get(task_id) {
            handle.answer(request_id.clone(), outcome.into());
        }
        self.emit_session(task_id, request);
        self.emit_session(
            task_id,
            wire::SessionUpdate::PermissionResolved {
                request_id,
                outcome: outcome.into(),
            },
        );
        true
    }

    /// The advisor's file writes are refused before any policy runs.
    pub(crate) fn advisor_policy_denial(&self, task_id: &str) -> Option<PolicyResult> {
        if self.is_thread_task(task_id) {
            return Some(PolicyResult::deny(
                "a Smith's thread is read-only; changes happen in a work session",
            ));
        }
        self.advisor_executor_of(task_id)
            .map(|_| PolicyResult::deny("the advisor is read-only"))
    }

    /// The sessions held read-only in all four places of ADR 0022: an
    /// advisor's, and a Smith's thread (ADR 0027 invariant 6).
    pub(crate) fn is_read_only_session(&self, task_id: &str) -> bool {
        self.advisor_executor_of(task_id).is_some() || self.is_thread_task(task_id)
    }

    fn is_thread_task(&self, task_id: &str) -> bool {
        self.tasks.get(task_id).is_some_and(|task| {
            task.origin.as_deref() == Some(crate::daemon::actor::smiths::SMITH_ORIGIN)
        })
    }

    /// Clean up after a deleted task: an executor takes its advisor with it,
    /// and a deleted advisor fails whatever it was answering.
    pub(crate) fn advisor_task_deleted(&mut self, task_id: &str) {
        self.advisors.states.remove(task_id);
        let orphans: Vec<String> = self
            .tasks
            .values()
            .filter(|task| {
                task.origin.as_deref() == Some(ADVISOR_ORIGIN)
                    && task.parent_task_id.as_deref() == Some(task_id)
            })
            .map(|task| task.id.clone())
            .collect();
        for id in orphans {
            let cmd_tx = self.cmd_tx.clone();
            tokio::spawn(async move {
                let (reply, _) = oneshot::channel();
                let _ = cmd_tx.send(Command::DeleteTask { id, reply }).await;
            });
        }
        let executor = self
            .tasks
            .values()
            .find(|task| {
                task.advisor
                    .as_ref()
                    .and_then(|advisor| advisor.task_id.as_deref())
                    == Some(task_id)
            })
            .map(|task| task.id.clone());
        if let Some(executor) = executor {
            if self
                .advisors
                .states
                .get(&executor)
                .is_some_and(|s| s.pending.is_some())
            {
                self.finish_consultation(&executor, Err("the advisor's task was deleted".into()));
            }
        }
    }

    fn is_pending(&self, executor: &str, consultation: u64) -> bool {
        self.advisors
            .states
            .get(executor)
            .and_then(|state| state.pending.as_ref())
            .is_some_and(|pending| pending.id == consultation)
    }
}
