//! A Smith's journal: the memory scope `smith:<id>` (ADR 0027 invariant 7).
//! Only that Smith's tasks write it; they and the user read it, and no other
//! session ever sees it.

use crate::daemon::actor::Daemon;
use crate::daemon::memory::{MemoryError, SMITH_SCOPE_PREFIX};
use crate::daemon::memory_types::Memory;
use crate::daemon::task::TaskStatus;

/// Journal entries an opening prompt carries, and their characters.
const BRIEF_ENTRIES: u32 = 10;
const BRIEF_CHARS: usize = 3000;

impl Daemon {
    /// The Smith a task runs as, if any.
    /// @param task_id the task
    /// @returns its Smith's id
    pub(crate) fn task_smith_id(&self, task_id: &str) -> Option<String> {
        self.tasks
            .get(task_id)?
            .smith
            .as_ref()
            .map(|smith| smith.smith_id.clone())
    }

    pub(crate) fn memory_journal_write(
        &mut self,
        smith_id: &str,
        content: &str,
        kind: Option<&str>,
        tags: Option<&[String]>,
        created_by: Option<&str>,
    ) -> Result<Memory, MemoryError> {
        let writer = created_by.and_then(|task| self.task_smith_id(task));
        if writer.as_deref() != Some(smith_id) {
            return Err(MemoryError::Scope(
                "a Smith's journal is written only by that Smith's own sessions".into(),
            ));
        }
        self.memory
            .store_journal(smith_id, content, kind, tags, created_by)
    }

    /// A session may name only its own Smith's journal; the user may name any.
    pub(crate) fn memory_reader_check(
        &self,
        task_id: Option<&str>,
        scope: Option<&str>,
    ) -> Result<(), MemoryError> {
        let (Some(task_id), Some(journal)) = (
            task_id,
            scope.and_then(|s| s.strip_prefix(SMITH_SCOPE_PREFIX)),
        ) else {
            return Ok(());
        };
        if self.task_smith_id(task_id).as_deref() == Some(journal) {
            Ok(())
        } else {
            Err(MemoryError::Scope(
                "only that Smith's own sessions read its journal".into(),
            ))
        }
    }

    /// Drop every journal entry the reading session may not see.
    pub(crate) fn memory_visible_to(
        &self,
        task_id: Option<&str>,
        found: Vec<Memory>,
    ) -> Vec<Memory> {
        let Some(task_id) = task_id else {
            return found;
        };
        let own = self
            .task_smith_id(task_id)
            .map(|id| format!("{SMITH_SCOPE_PREFIX}{id}"));
        found
            .into_iter()
            .filter(|m| !m.scope.starts_with(SMITH_SCOPE_PREFIX) || Some(&m.scope) == own.as_ref())
            .collect()
    }

    /// The newest journal entries after `since`, oldest first, within the caps.
    /// @param smith_id the Smith
    /// @param since the row id of the newest entry already given; 0 for none
    /// @returns the entries and the newest one's row id
    pub(crate) fn smith_journal_since(&self, smith_id: &str, since: u64) -> (Vec<Memory>, u64) {
        let entries = self
            .memory
            .journal_after(smith_id, since as i64, BRIEF_ENTRIES)
            .unwrap_or_default();
        let newest = entries.first().map_or(since, |(rowid, _)| *rowid as u64);
        let mut chars = 0;
        let mut kept: Vec<Memory> = Vec::new();
        for (_, entry) in entries {
            chars += entry.content.chars().count();
            if !kept.is_empty() && chars > BRIEF_CHARS {
                break;
            }
            kept.push(entry);
        }
        kept.reverse();
        (kept, newest)
    }

    /// The daemon's own record of a finished work session, written once when
    /// it settles, so what a Smith did never depends on the model writing it.
    /// @param task_id the task that settled
    pub(crate) fn smith_task_settled(&mut self, task_id: &str) {
        let Some(task) = self.tasks.get(task_id) else {
            return;
        };
        let thread = task.origin.as_deref() == Some(super::SMITH_ORIGIN);
        let Some(smith) = task.smith.as_ref().filter(|s| !s.journaled && !thread) else {
            return;
        };
        let settled = task.status == TaskStatus::Done || task.settled_override == Some(true);
        if !settled {
            return;
        }
        let smith_id = smith.smith_id.clone();
        let outcome = match task.status {
            TaskStatus::Blocked => "blocked",
            TaskStatus::Interrupted => "interrupted",
            _ => "finished",
        };
        let mut entry = format!(
            "Work session \"{}\" ({}) in {} {outcome}; {} files changed.",
            task.title, task.id, task.project, task.files_changed
        );
        if let Some(item) = &task.backlog_item_id {
            entry.push_str(&format!(" Board item {item}."));
        }
        let tags = vec!["work-session".to_string(), task.id.clone()];
        let written =
            self.memory
                .store_journal(&smith_id, &entry, Some("note"), Some(&tags), Some("daemon"));
        if written.is_ok() {
            if let Some(task) = self.tasks.get_mut(task_id) {
                if let Some(smith) = task.smith.as_mut() {
                    smith.journaled = true;
                }
                let updated = task.clone();
                self.persist(&updated);
            }
        }
    }
}
