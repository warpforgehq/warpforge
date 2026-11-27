//! Per-agent install health: whether the last background probe, session start
//! or install verification hit a broken-install signature.

use std::collections::HashMap;

use warpforge_protocol as wire;

use crate::daemon::actor::{Daemon, Event};

#[derive(Default)]
pub(crate) struct AgentHealth {
    marks: HashMap<String, wire::AgentBrokenInstall>,
    /// Bumped by an install's own verification: a probe that started before it
    /// tested the install that was replaced, so its verdict is dropped.
    generations: HashMap<String, u64>,
}

impl Daemon {
    /// Mark `id` broken only for a broken-install signature; an auth error or
    /// a timeout says nothing about the install and leaves health untouched.
    /// @param id the agent id
    /// @param text the failure the probe, session or install reported
    pub(crate) fn note_agent_failure(&mut self, id: &str, text: &str) {
        if !crate::daemon::agents::broken_install(text) {
            return;
        }
        let detail = text.to_string();
        let summary =
            crate::daemon::agents::broken_install_summary(text).unwrap_or_else(|| detail.clone());
        let broken = wire::AgentBrokenInstall { summary, detail };
        self.agent_health
            .marks
            .insert(id.to_string(), broken.clone());
        self.emit(Event::AgentHealthUpdated {
            id: id.to_string(),
            broken: Some(broken),
        });
    }

    /// Clear `id`'s tracked health after a successful probe or session start.
    /// A no-op when it was already healthy, so a healthy agent does not spam
    /// clients with redundant events.
    /// @param id the agent id
    pub(crate) fn clear_agent_health(&mut self, id: &str) {
        if self.agent_health.marks.remove(id).is_some() {
            self.emit(Event::AgentHealthUpdated {
                id: id.to_string(),
                broken: None,
            });
        }
    }

    /// Record an install's own verification and retire every probe started
    /// before it.
    /// @param id the agent id
    /// @param result `Ok` when the installed agent started, else why it did not
    pub(crate) fn observe_agent_health(&mut self, id: &str, result: Result<(), String>) {
        *self
            .agent_health
            .generations
            .entry(id.to_string())
            .or_default() += 1;
        match result {
            Ok(()) => self.clear_agent_health(id),
            Err(error) => self.note_agent_failure(id, &error),
        }
    }

    /// The install generation a probe starting now tests.
    /// @param id the agent id
    /// @returns the generation to hand back with the probe's verdict
    pub(crate) fn agent_health_generation(&self, id: &str) -> u64 {
        self.agent_health
            .generations
            .get(id)
            .copied()
            .unwrap_or_default()
    }

    /// Record a probe's verdict, unless an install replaced what it tested.
    /// @param id the agent id
    /// @param generation what [`Self::agent_health_generation`] said at probe start
    /// @param result `Ok` when the probe's handshake completed, else its error
    pub(crate) fn note_probe_health(
        &mut self,
        id: &str,
        generation: u64,
        result: Result<(), String>,
    ) {
        if generation != self.agent_health_generation(id) {
            return;
        }
        match result {
            Ok(()) => self.clear_agent_health(id),
            Err(error) => self.note_agent_failure(id, &error),
        }
    }

    /// Fill each detected agent's health from the marks held now.
    /// @param detected the detection result, updated in place
    pub(crate) fn attach_agent_health(&self, detected: &mut [wire::DetectedAgent]) {
        for agent in detected {
            agent.broken_install = self.agent_health.marks.get(&agent.id).cloned();
        }
    }

    /// The command an agent's health describes: its configured command, else
    /// its registry default.
    /// @param id the agent id
    /// @returns the command, or `None` for an agent the daemon does not know
    pub(crate) fn agent_health_command(&self, id: &str) -> Option<String> {
        self.configured_agents
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.acp_command.clone())
            .or_else(|| {
                crate::daemon::agents::known_agent(id)
                    .map(|agent| agent.default_acp_command.to_string())
            })
    }

    /// The registered agent whose health a task's session speaks for.
    pub(crate) fn session_health_agent(&self, task_id: &str) -> Option<String> {
        let task = self.tasks.get(task_id)?;
        let id = self.agent_id_of(&task.agent);
        self.configured_agents
            .iter()
            .find(|agent| agent.id == id)
            .map(|agent| agent.id.clone())
    }
}
