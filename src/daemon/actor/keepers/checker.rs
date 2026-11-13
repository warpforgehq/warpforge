//! Starting a run: the paths and quota gates, the cap on checker sessions,
//! and the hidden read-only child task that checks (ADR 0030, *Mapping onto
//! tasks and the engine*).

use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::oneshot;
use warpforge_protocol as wire;

use super::trigger::is_quota_skip;
use super::{InFlight, KeeperCommand, KEEPER_ORIGIN};
use crate::daemon::accounts::SpawnAccount;
use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::{Command, Daemon, Event};
use crate::daemon::keepers::{
    commits_since, dismissed_list, render_prompt, touches, Change, PromptVars, MAX_CHECKERS,
    QUOTA_SKIP,
};
use crate::daemon::task::{now_secs, Task, TaskStatus};

impl Daemon {
    /// The task a keeper's checker checks, when `task_id` is a checker.
    pub(crate) fn keeper_parent_of(&self, task_id: &str) -> Option<String> {
        self.tasks
            .get(task_id)
            .filter(|task| task.origin.as_deref() == Some(KEEPER_ORIGIN))
            .and_then(|task| task.parent_task_id.clone())
    }

    fn keeper_checker(&self, task_id: &str, keeper_id: &str) -> Option<String> {
        let tag = format!("keeper:{keeper_id}");
        self.tasks
            .values()
            .find(|task| {
                task.origin.as_deref() == Some(KEEPER_ORIGIN)
                    && task.parent_task_id.as_deref() == Some(task_id)
                    && task.tags.contains(&tag)
            })
            .map(|task| task.id.clone())
    }

    /// The keeper's checker when its session still fits the keeper; a
    /// checker on another agent or model, or a blocked one, is deleted, so
    /// the run starts a fresh one instead of loading a session it cannot.
    fn keeper_reusable_checker(
        &mut self,
        task_id: &str,
        definition: &wire::KeeperDefinition,
        agent: &str,
    ) -> Option<String> {
        let id = self.keeper_checker(task_id, &definition.id)?;
        let checker = self.tasks.get(&id)?;
        let fits = self.agent_id_of(&checker.agent) == self.agent_id_of(agent)
            && checker.model == definition.model
            && checker.status != TaskStatus::Blocked;
        if fits {
            return Some(id);
        }
        // The delete is queued; dropping the tag now keeps `keeper_checker`
        // from handing the retired checker to this run meanwhile.
        if let Some(checker) = self.tasks.get_mut(&id) {
            checker.tags.clear();
        }
        let cmd_tx = self.cmd_tx.clone();
        let retired = id.clone();
        tokio::spawn(async move {
            let (reply, _) = oneshot::channel();
            let _ = cmd_tx
                .send(Command::DeleteTask { id: retired, reply })
                .await;
        });
        None
    }

    pub(super) fn keepers_gathered(
        &mut self,
        task_id: &str,
        head: &str,
        trigger: wire::KeeperWhen,
        keepers: Vec<wire::KeeperDefinition>,
        change: Result<Change, String>,
    ) {
        for keeper in &keepers {
            self.keepers
                .gathering
                .remove(&(task_id.to_string(), keeper.id.clone()));
        }
        let Some(task) = self.tasks.get(task_id).cloned() else {
            return;
        };
        let current = match trigger {
            wire::KeeperWhen::Commit => {
                self.keepers.watches.get(task_id).and_then(|w| w.head()) == Some(head)
            }
            _ => self
                .keepers
                .ready
                .get(task_id)
                .is_some_and(|r| r.head == head),
        };
        if !current || !self.keeper_candidate(&task) {
            if trigger == wire::KeeperWhen::Ready {
                self.keepers_ready_resume();
            }
            return;
        }
        for definition in keepers {
            let due = match trigger {
                wire::KeeperWhen::Commit => self.keeper_due(task_id, &definition.id, head),
                _ => !self.keeper_busy(task_id, &definition.id),
            };
            if !due {
                continue;
            }
            if let Some(ready) = self.keepers.ready.get_mut(task_id) {
                ready.queued.retain(|queued| queued.id != definition.id);
            }
            let change = match &change {
                Ok(change) => change,
                Err(error) => {
                    let run = self.keeper_new_run(task_id, &definition.id, trigger, head, None);
                    self.keeper_close(run, wire::KeeperOutcome::Error, error.clone());
                    continue;
                }
            };
            if !touches(&definition.paths, &change.files) {
                let run = self.keeper_new_run(task_id, &definition.id, trigger, head, Some(change));
                let reason = "the change touches none of the keeper's paths".to_string();
                self.keeper_close(run, wire::KeeperOutcome::Skipped, reason);
                continue;
            }
            let agent = definition.agent.clone().unwrap_or(task.agent.clone());
            let account = match self.keeper_reusable_checker(task_id, &definition, &agent) {
                Some(checker) => self.spawn_account(&checker),
                None => SpawnAccount::Active,
            };
            if let Some(reason) = self.dispatch_refusal(&agent, account) {
                let latest = self.keepers.latest_run(task_id, &definition.id);
                if !latest.is_some_and(|run| run.head_sha == head && is_quota_skip(run)) {
                    let run =
                        self.keeper_new_run(task_id, &definition.id, trigger, head, Some(change));
                    let reason = format!("{QUOTA_SKIP}: {reason}");
                    self.keeper_close(run, wire::KeeperOutcome::Skipped, reason);
                }
                continue;
            }
            if self.keepers.in_flight.len() >= MAX_CHECKERS {
                match (trigger, self.keepers.ready.get_mut(task_id)) {
                    (wire::KeeperWhen::Commit, _) => {
                        if let Some(watch) = self.keepers.watches.get_mut(task_id) {
                            watch.nudge();
                        }
                    }
                    (_, Some(ready)) => ready.queued.push(definition),
                    (_, None) => {}
                }
                continue;
            }
            self.keeper_start(&task, definition, agent, trigger, head, change);
        }
        self.keepers_fix(task_id, None);
    }

    fn keeper_new_run(
        &self,
        task_id: &str,
        keeper_id: &str,
        trigger: wire::KeeperWhen,
        head: &str,
        change: Option<&Change>,
    ) -> wire::KeeperRun {
        let run_number = self
            .keepers
            .latest_run(task_id, keeper_id)
            .map_or(1, |run| run.run_number + 1);
        wire::KeeperRun {
            id: format!("kr_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]),
            task_id: task_id.to_string(),
            keeper_id: keeper_id.to_string(),
            run_number,
            trigger,
            head_sha: head.to_string(),
            base_sha: change.and_then(|c| c.base_sha.clone()),
            started_at: now_secs(),
            round: self.keeper_loop(task_id, keeper_id).rounds,
            ..Default::default()
        }
    }

    fn keeper_close(
        &mut self,
        mut run: wire::KeeperRun,
        outcome: wire::KeeperOutcome,
        why: String,
    ) {
        run.outcome = Some(outcome);
        run.finished_at = Some(now_secs());
        run.error = Some(why);
        self.keeper_record(run, Vec::new());
    }

    fn keeper_start(
        &mut self,
        task: &Task,
        definition: wire::KeeperDefinition,
        agent: String,
        trigger: wire::KeeperWhen,
        head: &str,
        change: &Change,
    ) {
        let previous = self
            .keepers
            .latest_run(&task.id, &definition.id)
            .map(|run| run.head_sha.clone());
        let vars = PromptVars {
            task_title: task.title.clone(),
            task_brief: task.prompt.clone(),
            diff: change.diff.clone(),
            commits: commits_since(&change.log, previous.as_deref()),
            dismissed: dismissed_list(&self.keepers.keeper_findings(&task.id, &definition.id)),
            rules: change.rules.clone(),
        };
        let prompt = render_prompt(&definition, &vars);
        let mut run = self.keeper_new_run(&task.id, &definition.id, trigger, head, Some(change));
        let existing = self.keeper_checker(&task.id, &definition.id);
        let checker = match existing.clone() {
            Some(checker) => checker,
            None => self.keeper_create_checker(task, &definition, &agent, &prompt),
        };
        run.checker_task_id = Some(checker.clone());
        let time_limit = Duration::from_secs(definition.time_limit_secs);
        self.keepers.in_flight.insert(
            run.id.clone(),
            InFlight {
                task_id: task.id.clone(),
                checker_task_id: checker.clone(),
                definition: definition.clone(),
                dispatched: true,
                started: false,
                reasked: false,
                superseded: false,
                baseline_cost: self.keepers.costs.get(&checker).copied(),
            },
        );
        let run_id = run.id.clone();
        self.keeper_record(run, Vec::new());
        match existing {
            Some(_) => self.keeper_prompt(&run_id, checker, prompt),
            None => {
                self.keeper_start_session(&checker, &task.project, &definition, &agent, &prompt);
                if !self.sessions.contains_key(&checker) {
                    let error = self
                        .tasks
                        .get(&checker)
                        .and_then(|task| task.blocked_reason.clone())
                        .unwrap_or_else(|| "the checker's agent did not start".into());
                    self.keeper_run_failed(&run_id, wire::KeeperOutcome::Error, error);
                    return;
                }
            }
        }
        let cmd_tx = self.cmd_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(time_limit).await;
            let _ = cmd_tx
                .send(Command::Keepers(KeeperCommand::Deadline { run_id }))
                .await;
        });
    }

    fn keeper_create_checker(
        &mut self,
        task: &Task,
        definition: &wire::KeeperDefinition,
        agent: &str,
        prompt: &str,
    ) -> String {
        let tags = vec![format!("keeper:{}", definition.id)];
        let mut checker = Task::new(&task.project, prompt, agent, tags);
        checker.title = match task.title.trim() {
            "" => definition.name.clone(),
            title => format!("{} · {title}", definition.name),
        };
        checker.parent_task_id = Some(task.id.clone());
        checker.origin = Some(KEEPER_ORIGIN.to_string());
        checker.model = definition.model.clone();
        let id = checker.id.clone();
        self.tasks.insert(id.clone(), checker.clone());
        self.persist(&checker);
        self.emit(Event::TaskCreated(checker));
        id
    }

    fn keeper_start_session(
        &mut self,
        checker: &str,
        project: &str,
        definition: &wire::KeeperDefinition,
        agent: &str,
        prompt: &str,
    ) {
        let mut overrides = HashMap::new();
        if let Some(effort) = &definition.effort {
            let agent_id = self.agent_id_of(agent);
            let options = self
                .configured_agents
                .iter()
                .find(|candidate| candidate.id == agent_id)
                .map(|candidate| candidate.models.as_slice())
                .unwrap_or_default();
            if let Some((id, value)) = effort_option(options, effort) {
                overrides.insert(id, value);
            }
        }
        self.start_session(
            checker,
            project,
            agent,
            prompt,
            false,
            None,
            Vec::new(),
            definition.model.clone(),
            overrides,
        );
    }

    /// Through `SessionPrompt`, so a lost session resumes the way a person's
    /// message would, with the read-only mode set again on that start.
    pub(super) fn keeper_prompt(&self, run_id: &str, checker: String, text: String) {
        let cmd_tx = self.cmd_tx.clone();
        let run_id = run_id.to_string();
        tokio::spawn(async move {
            let (reply, answer) = oneshot::channel();
            let sent = cmd_tx
                .send(Command::SessionPrompt {
                    task_id: checker,
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
                .send(Command::Keepers(KeeperCommand::Undelivered {
                    run_id,
                    error: format!("the checker could not be reached: {error}"),
                }))
                .await;
        });
    }

    /// Stop the checker so a late verdict cannot be read as the next run's.
    pub(super) fn keeper_deadline(&mut self, run_id: &str) {
        let Some(flight) = self.keepers.in_flight.get(run_id) else {
            return;
        };
        let checker = flight.checker_task_id.clone();
        let minutes = flight.definition.time_limit_secs.div_ceil(60);
        if let Some(handle) = self.drop_session(&checker) {
            handle.cancel();
        }
        if let Some(task) = self.tasks.get_mut(&checker) {
            task.set_status(TaskStatus::Interrupted);
            let updated = task.clone();
            self.persist(&updated);
            self.emit(Event::TaskUpdated(updated));
        }
        let error = format!("the checker did not finish within {minutes} min");
        self.keeper_run_failed(run_id, wire::KeeperOutcome::Inconclusive, error);
    }
}

/// The harness's reasoning-effort selector set to `effort`, when it has one.
fn effort_option(options: &[wire::ConfigOption], effort: &str) -> Option<(String, String)> {
    let selector = options.iter().find(|o| {
        let identity = format!(
            "{} {} {}",
            o.category.as_deref().unwrap_or(""),
            o.id,
            o.name
        )
        .to_lowercase();
        ["thought_level", "effort", "reasoning"]
            .iter()
            .any(|word| identity.contains(word))
    })?;
    selector
        .options
        .iter()
        .find(|choice| choice.value.eq_ignore_ascii_case(effort))
        .map(|choice| (selector.id.clone(), choice.value.clone()))
}
