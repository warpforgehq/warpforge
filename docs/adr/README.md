# Architecture decision records

Decisions that are **not recoverable from the code**: what was chosen, what was
rejected, and which invariants a future change must not break. If something can
be learned by reading the code, it does not belong here — that duplication goes
stale and then misleads.

- One file per decision or per coherent cluster of decisions, numbered:
  `NNNN-short-slug.md`.
- Records are append-only. Don't rewrite a decision that changed — add a new
  record and mark the old one `Superseded by NNNN`.
- Keep each one short enough to read in full before touching the subsystem.
  The **Invariants** section is the part that prevents regressions; put real
  effort there and name the module it applies to.

| ADR | Subject |
| --- | --- |
| [0001](0001-workflow-pipelines.md) | Workflow pipelines: deterministic engine, project-configured |
| [0002](0002-daemon-concurrency.md) | Daemon concurrency: non-blocking mailboxes, sharded per task |
| [0002](0002-issue-tracker-integration.md) | Backlog ↔ issue trackers: one table, daemon-owned links |
| [0003](0003-workflow-agent-loss.md) | Losing a stage's agent pauses a pipeline, it does not fail it |
| [0004](0004-project-page-surfaces.md) | The project page is surfaces, and the backlog is a list |
| [0005](0005-chat-transcript-scrolling.md) | The virtualiser owns the chat scroll, and the transcript arrives whole |
| [0006](0006-explicit-port-pinning.md) | Ports are pinned explicitly, not derived from list positions |
| [0007](0007-scheduled-automations.md) | Scheduled automations: the mirror, the run, and the tick |
| [0008](0008-prompt-file-attachments.md) | Prompt attachments carry text, not blobs |
| [0010](0010-pull-request-inbox.md) | The PR inbox is a second surface, not a backlog column |
| [0011](0011-agent-turn-lifecycle.md) | A session runs one turn at a time, and every turn says who asked for it |
| [0014](0014-quit-stops-the-daemon.md) | Quitting the app stops the daemon it started |
| [0015](0015-worktree-lifecycle-across-restarts.md) | Worktree lifecycle survives a daemon restart |
| [0016](0016-service-readiness.md) | Service readiness has one verdict per run, and a deadline |
| [0017](0017-daemon-origin-and-path-confinement.md) | The daemon checks WebSocket origins and confines client paths |
| [0018](0018-session-bridge-identity.md) | A session's warpforge bridge takes its identity from the agent's environment |
| [0019](0019-quota-gate-at-dispatch.md) | Unattended work is gated on known quota exhaustion, at dispatch |
| [0020](0020-task-pull-request-status.md) | A worktree task's pull request is a daemon cache, pushed as it changes |
| [0021](0021-agent-driven-browser.md) | Agents drive the in-app browser through a daemon → client request |
| [0022](0022-advisor-mode.md) | An advisor is a hidden, read-only child session the executor consults |
| [0024](0024-workflow-verify-stage.md) | Workflows verify a change in the running app before review |
| [0025](0025-inline-html-renders.md) | Agents show HTML pages inline, framed and served by the desktop |
