# 0023 — The backlog runner: a daemon queue that turns ready items into pull requests

> The desktop attention and dashboard presentation in this record was superseded by [0032](0032-permanent-rail.md#2026-11-27-update).

**Status:** accepted (2026-09-29) · Phase 1 built; later phases proposed ·
amended 2026-09-30: *Factory as a task mode* supersedes the Factory surface,
Start/Pause and per-item queue editing described below

## Context

Warpforge has most of the parts of an "agent factory": isolated worktrees
(ADR 0015), several harnesses, deterministic pipelines (ADR 0001), an
orchestrator with sub-agents, a backlog (ADR 0002 tracker), cron automations
(ADR 0007), a quota gate (ADR 0019), Advisor mode (ADR 0022), and PR status
with checks and review remarks (ADR 0020). What it lacks is the loop that
connects them. Today a person, or an orchestrator chat on their behalf, runs
that loop by hand: pick an item, write a brief, launch an agent, read the diff,
send findings back, commit, open the PR, close the item.

The data shows the loop is manual and leaves nothing behind. The local store
holds 4 workflow runs against 68 orchestrator sub-agent tasks, and exactly one
task that ever ran in a worktree. Only 3 tasks are linked to a backlog item.
Items that have shipped (#78, #81, #87, #97–#101, #109) still say `todo`,
because nothing closes an item when its work lands.

What exists and what each piece of the loop is missing:

| Piece | Exists (reused) | Missing |
| --- | --- | --- |
| Queue | Backlog items with `priority` and `task_id` (`store/backlog.rs`, `backlog.rs` `priority_rank`); `workItem.linkTask` sets `in_progress` | No "ready" marker, no order, nothing dispatches. `status` is overwritten by tracker sync for imported items (`store/backlog.rs` `update_backlog_remote`) |
| Dispatch | `Command::CreateWorkflowTask` → `workflow_create` (`actor/workflow.rs`) with worktree + `StartPoint::fork`; stage gate `workflow_stage_refusal` (`actor/dispatch_gate.rs`) | Concurrency limit, priority order, pre-dispatch gate across all stage agents. `CreateWorkflowTask` drops `backlog_item_id`, so a pipeline parent is never linked back to its item |
| Per-item choice | Workflow YAML pins per-stage agent/model; lead agent/model/overrides per task | Advisors are refused for workflow tasks (`server/dispatch/tasks.rs`, ADR 0022), so "advisor" is a different mode, not a per-item flag on a pipeline |
| Gates | Precheck runner `automations/schedule.rs` `run_precheck` (120 s, output clipped to 400 bytes) | Any deterministic check in a pipeline (ADR 0001 "out of scope"; #94) |
| Output | `diff::commit`, `diff::push` (force-with-lease), `diff::create_pr` (`gh`); `PullWatch` (`daemon/pull_status/`); `removal_blocker`; `worktree/reclaim.rs` | Nothing commits or opens a PR after a pipeline; `PullWatch` only polls after a client asks; merged/closed never reaches the backlog |
| CI loop | `failed_checks`, `open_comments`, desktop `lib/prFeedback.ts` + `store/prFeedback.ts` (click to send) | Daemon-side watermark and send. A finished pipeline parent has no session: `useWorkflowSend` returns `true` for a finished run and sends nothing, and `PrFeedbackNotice` then records the keys as handled — the feedback is silently dropped |
| Metrics | Cost samples in `session_updates` (`SessionUpdate::Usage`), summed per task by `spend::sum_runs`; `workflow_runs.run_json` (round, `StageRecord` history, findings); task timestamps | Cost rows are pruned with the transcript after `retention_days` (30) and tasks with their run after `delete_closed_after_days` (90). `StageRecord` has no model, no timestamps, no cost. PR number and merge time are in memory only. Codex reports no cost at all |
| Attention | Workflow barriers render in Needs you (`lib/attentionRail.ts`) | Every `paused` barrier is hidden from Needs you, including the ones the daemon parks itself (quota, ADR 0019; lost agent, ADR 0003). With N unattended runs those are exactly the ones nobody sees |
| Disk | `worktree:` `copy` + `setup` (`worktree/setup.rs`), Worktrees panel, reclaim | No clonefile seed; a fully built worktree of this repo is ~15 GB, and the owner's disk has 10–18 GB free. This is why orchestrator children hardcode `worktree: false` |

## Owner decisions (2026-09-29)

These settle what the proposal left open; where they differ from the text
below, the text has been amended to match.

1. **Work comes from the backlog, GitHub issues included.** The runner works
   on local items and on items synced from GitHub (or Linear) alike; an
   imported item keeps its issue link. The draft PR body starts with
   `Closes #N` for a GitHub-sourced item, so merging it closes the issue, and
   with the item's link or number otherwise.
2. **The runner is a factory: it commits and opens a draft PR.** This narrows
   ADR 0001's "a finished pipeline commits nothing" for runner-owned runs
   only (cross-referenced there). Every pipeline a person starts still
   commits nothing.
3. **The runner runs whatever workflow the queue is set to.** A workflow with a
   `verify` stage (browser check of the running app) needs nothing from the
   runner; when the run has a verification, its verdict and checklist go into
   the PR body.
4. **Review is agents inside the workflow, humans at the end.** The workflow's
   review ⇄ fix loop is the only review before the PR. People review the
   finished draft PR. There is no human barrier mid-run by default; the
   barriers a pipeline raises itself (a stage question, the review limit, a
   quota or lost-agent pause) surface in Needs you as they do today and keep
   the entry's slot.

## Decision

**A backlog runner: a daemon subsystem that dispatches queued backlog items
through a workflow pipeline, each in a fresh worktree, and delivers each
successful run as a draft pull request.** The human queues items, answers
barriers and reviews PRs. The runner never merges in the first phases.

### Where it lives

- Pure logic in `src/daemon/runner/` (new): queue ordering, the entry state
  machine, slot accounting, the headroom verdict, brief rendering. No side
  effects, unit-tested like `daemon/workflow/`.
- Actor glue in `src/daemon/actor/runner/` (new, a directory module from the
  start): enqueue/dequeue commands, dispatch, the hooks below, delivery.
- Store in `src/daemon/store/runner.rs` (new): tables `runner_settings`
  (per project), `runner_queue` (one row per queued item), `item_runs` (one row
  per attempt, the metrics fact table).
- Wire types in `crates/warpforge-protocol/src/runner.rs` (new); `Method` and
  `Event` variants in their single files. The actor gets one
  `Command::Runner(RunnerCommand)` variant; `RunnerCommand` is matched
  exhaustively in `actor/runner/mod.rs`, so a new runner command cannot fall
  through the chained dispatcher.
- Desktop: a **Run in Factory** action on backlog rows and in the drawer, row
  checkboxes with **Run selected in Factory**, and a **Factory** surface on the
  project page (ADR 0004): queue order, entry states, Start/Pause, settings,
  recent runs with outcome, cost and PR. "Factory" is the user-facing name;
  the code says runner.

It follows ADR 0007's shape: the actor's in-memory mirror is authoritative and
the store is eventual; every read goes through the mirror.

### The queue is its own table, keyed by backlog item id

A queue entry holds what is machine-local: position, the chosen workflow, lead
agent/model/overrides, attempts, state, task id, PR number. It is keyed by the
backlog item's client-generated id, which is stable across storage modes and
tracker imports (ADR 0002). The backlog item keeps only its user-facing status,
which the runner writes at transitions: `in_progress` at dispatch, `waiting`
when a PR opens, `done` on merge, back to `todo` on failure or a closed PR.

### Dispatch

Triggered by events, not polling: enqueue, runner resume, settings change, and
every entry transition that frees a slot. The one-minute tick that drives
automations (`actor/spawn/mod.rs`) also sends a runner tick, which re-checks
quota headroom and sweeps entries whose task is gone.

An entry is dispatched when all of these hold:

1. The runner is enabled and not paused for the project.
2. **In-flight** entries (dispatched, not yet delivered or ended) are below
   `max_concurrent` (default 1). An entry parked at a barrier still counts: it
   holds a worktree and a question.
3. Runner PRs still open are below `max_open_prs` (default 3). Human review is
   the real throughput limit; a runner that produces more PRs than anyone reads
   is producing risk.
4. Today's dispatch count is below `max_per_day` (default 10).
5. Every agent the pipeline will start (lead, each reviewer, fix) passes
   `limits::gate::refusal` and a stricter **headroom** check: no fresh window
   above `headroom_pct` (default 80). ADR 0019's stage gate still runs
   underneath for every stage; headroom applies only to starting new items,
   never to stages of a run already in flight.
6. Free disk on the project volume is above `min_free_gb` (default 25).

Order: backlog priority (`priority_rank`), then manual queue position, then
enqueue time. An entry that fails 5 is skipped, not dropped; the next one whose
agents are available may go first. Gates 1–4 and 6 hold the whole queue and are
shown as the project's `hold`; gate 5 and an unreadable item or workflow mark
only that entry's `waiting_reason`. The day in 4 is a rolling 24 hours, seeded
at boot from `item_runs.dispatched_at`.

Dispatch sends `CreateWorkflowTask` with `worktree: true`, tags `runner` and
`workflow:<id>`, the item id (fixing the dropped `backlog_item_id`), and a
brief: a fixed runner preamble, the item number and title, and the body. The
preamble says not to commit or push. The implement stage committing its own
work would give reviewers an empty working-copy diff (ADR 0001
*Consequences*). The body of an item imported from a tracker goes inside the
`<github_untrusted>` scheme (`src/mcp/untrusted.rs`, ADR 0020 invariant 8).

The fork base is the remote's default branch, fetched, through the existing
`StartPoint::fork`. A PR's diff is taken against the remote base, so a task
branch forked from a local branch with unpushed commits would carry those
commits into the PR.

### Delivery

The runner hooks `workflow_finalize` (`actor/workflow_control.rs`) the same way
`deliver_child_result` does. On `Success { limit_hit: false }`, off the actor
loop:

1. Refuse to deliver an empty change: no diff and no commits against the fork
   point means the run ends as `no_changes`, and the item goes back to `todo`.
2. Commit everything in the worktree on its `warpforge/task/*` branch
   (`diff::commit`), except untracked files the project's `worktree.copy`
   put there (a copied `.env` is a local file, not part of the change). The
   message is the item title with `(#N)`, and the body is the implementer's
   final summary.
3. Push (`diff::push`) and open a **draft** PR (`diff::create_draft_pr`, the
   draft form of `create_pr`). The body carries the item link (`Closes #N` for
   an issue from the same GitHub repo), the implementer summary, the last verification
   when the workflow has a verify stage (verdict and checklist, never local
   screenshot paths), the low-severity findings the fixer never saw
   (`deferred_findings`), the rounds used and the cost where it was reported.
   Cost is summed off the loop from the stage sessions' reported USD at
   pipeline end, before retention can prune the transcripts.
4. Record the PR on the entry and the `item_runs` row, register the task with
   `PullWatch`, and start its poll loop from the daemon rather than waiting for
   a client refresh. A bridge task (`actor/runner/pulls.rs`) holds a weak
   command sender: it asks `PullWatch` to refresh each delivered task and
   forwards merged or closed `task.pullRequest` events to the actor.

`limit_hit: true`, `Stopped`, `Error`, and a delivery failure (no `gh`, signed
out, push rejected) end the run without a PR. The entry state names what
happened, and the item goes back to `todo`. The task stays a normal board task,
so a person can finish it by hand with the existing push dialog.

The runner, not the pipeline, commits. ADR 0001's "a finished pipeline commits
nothing" stands for every pipeline a person starts. The runner is opt-in per
project and writes only to a branch it created and never merges it. That
narrows the rejected `on_success: commit`: history the runner writes is a
disposable branch plus a draft PR that a human has to act on.

### When an item is done

- **Run succeeded:** reviewers approved with no critical, high or medium
  finding open, the round limit was not hit, the diff is non-empty and, from
  Phase 2, the project's checks pass.
- **Delivered:** a PR is open. The item is `waiting`, and the human's move is
  review.
- **Done:** the PR merged. `PullWatch` sees `open → merged` on its poll, and
  the runner sets the item to `done` and records `merged_at`. For a tracker
  item, `Closes #N` closes the issue and the next sync agrees. A PR closed
  without merge means the item goes back to `todo` and the run counts as
  **rejected**. That is the most honest quality signal the runner gets.

### Pause and stop

**Pause runner** stops dispatching; in-flight runs continue, as workflow pause
is soft (ADR 0001). **Stop runner** pauses and cancels every in-flight run,
after a confirmation. Per-entry: dequeue (before dispatch), cancel (cancels the
pipeline), retry (a new attempt — never automatic). Phase 1 ships Pause,
dequeue and retry-by-queuing-again; one run is cancelled by stopping its
pipeline from its task. Stop runner is built (see the *Run location*
amendment): stopped entries go back to the queue rather than out of it.

### Quality gates (Phase 2)

A workflow gains an optional `checks:` block: named shell commands run in the
worktree, each with a timeout (default 15 min), with full output kept in a log
beside `<task>.setup.log`. They run after implement and after every fix, before
reviewers are started. A failing check does not start a review round. It hands
its output tail to the fix stage as findings with severity `high` and reviewer
`check <name>`, and counts against `max_check_fixes` (default 2), separate from
`max_rounds`. The pipeline shape and determinism are unchanged: this is a
barrier inside `implement/fix → review`, not a new stage type. The same checks
passing is part of "run succeeded", so the runner never opens a PR whose own
declared checks fail.

This answers #94 by building the gate as an option and measuring it, rather
than by mining existing timelines. There are four stored runs, too few to
measure anything. `item_runs` records check failures and review findings
separately, so the question "do gates save rounds" gets answered with data from
Phase 2 onward.

### The PR loop (Phase 3)

**Reopen a finished pipeline.** A new engine transition takes a `Done` run with
external findings back to Fix → Review → Done, in the same worktree. The
external findings are failed checks, a merge conflict, or PR review remarks.
This is what lets CI feedback reach a pipeline task at all: today a finished
parent has no session and the desktop drops the send. Reopen counts
`ci_rounds` (default cap 2), separate from review rounds, and keeps ADR 0001's
take/put and round-counter invariants.

**Auto-send CI failures for runner tasks only.** ADR 0020 deferred auto-send
for three reasons. It must work with the window closed, so the "already sent"
watermark moves into the daemon (on the `item_runs` row, keyed as ADR 0020
keys it: head commit + check name). It must go through the quota gate, and
reopen does, because it starts stages. And nothing sent on its own, which
becomes: nothing sends on its own except a runner task in a project whose
runner has `ci_autosend` on. The feedback formatting moves from
`lib/prFeedback.ts` to Rust so the daemon can build the prompt, and it keeps
the untrusted block. Review remarks are not auto-sent: anyone who can comment
writes them, and a remark often needs the owner's judgment.

**Flaky checks.** Before sending, an Actions check that failed is re-run once
(`gh run rerun <id> --failed`). Only a failure that repeats on the same head
commit reopens the pipeline. The flake is recorded, which costs CI minutes
rather than tokens.

**Conflicts.** The PR listing adds `mergeable`. When it reads `CONFLICTING`,
the runner reopens with a conflict finding. The fix stage merges the remote
base into the task branch and resolves the conflict, and a review round
follows. It is a merge commit, never a rebase: no force-push, and the PR's
history keeps what reviewers already saw. The squash at merge time flattens it.

### Merging (Phase 4)

A solo owner cannot approve their own PR on GitHub, so "review approved" has to
be an in-app action. **Approve & merge when green** records the approval and
merges (`gh pr merge --squash`) once checks pass, the PR is mergeable, and the
head is the commit that was approved. A push after the approval voids it. After
the merge, the runner removes the worktree through the ADR 0020 cleanup path
when `removal_blocker` allows it. Fully unattended auto-merge is opt-in per
item kind (Phase 6 labels). It requires at least one required check on the
repo, because with none GitHub merges at once. The runner offers it only after
the metrics show a low rejection rate for that kind.

### Metrics (Phase 5; the row is written from Phase 1)

`item_runs` is written at every transition and never rebuilt from transcripts,
which are pruned. One row per attempt holds: item, task, workflow, lead
agent/model/account, enqueue/dispatch/finish/PR/merge times, rounds, check
failures, findings by severity, CI rounds, flakes, barrier answers (human
interventions), outcome, and cost (USD, nullable). Stage-level rows
(`item_run_stages`) add agent, model, start/end and cost per child, snapshotted
with `spend::sum_runs` at stage end. `StageRecord` gains `model` and timestamps
with `serde(default)` (ADR 0001 invariant 10).

The Runner surface shows throughput (merged per week), cost per merged item,
the rounds distribution, success and rejection rate per lead agent/model, the
median time to PR and time from PR to merge (the human-latency number), and CI
rounds. Every figure carries its sample size. "Not reported" is shown as such,
never as `$0`, because Codex reports no cost.

### Learning (Phase 6)

Backlog items gain `labels`, imported from the tracker or set locally, and the
runner uses one of them as the item's kind. Routing is a suggestion shown at
enqueue: the agent/model with the best rejection-adjusted success and cost for
that kind, and only once n ≥ 10. It never switches silently. A cheap mode for
small items — a single agent with an advisor (ADR 0022) plus Phase 2 checks as
the definition of done — becomes a second pipeline choice. Memory harvest (#83)
gets a runner source: at merge, the findings that were fixed and the
assumptions the implement stage recorded are proposed into the memory approval
queue. That needs #83's content-carrying proposal kind.

## Rejected alternatives

- **An automation kind.** Automations are one prompt on a cron with a single
  overlap guard (`automation_active`, ADR 0007 invariant 3). The runner is
  event-driven, per item, with N slots and per-item configuration. Forcing it
  into `automations` would bend every one of ADR 0007's invariants. The runner
  reuses the patterns (mirror, tick, precheck runner), not the type. An
  automation may later *enqueue* items.
- **The chat orchestrator as the loop driver**, which is what is done by hand
  today. It is ADR 0001's rejected "manager agent": the next step is whatever
  the model felt like, every wake costs tokens, failures cannot be reproduced,
  and its children run without worktrees. It stays a client instead: MCP tools
  `runner_enqueue` and `runner_status` let an orchestrator fill and read
  the queue.
- **A `ready` backlog status or label.** Tracker sync overwrites `status`.
  Queue order and harness choice are machine-local, while a YAML backlog is
  shared through git.
- **An external script over RPC.** It cannot see the quota snapshot or the
  turn events, and it dies with its terminal.
- **Delivering by local merge-back** (`merge_detached`, ADR 0015). It bypasses
  CI and the PR review surface. It is kept as a later `branch` output mode for
  projects without a GitHub remote.
- **Rebase and force-push on conflict.** It rewrites what reviewers saw and
  races a human looking at the PR.
- **Automatic retry of a failed run.** Same reason as ADR 0003: a failure
  usually repeats, and silent retries burn tokens.

## Invariants

1. **The runner writes only to branches it created** (`worktree::owns_branch`).
   No commit to the base or to a user branch, and no force-push. Its worktrees
   fork from the fetched remote default branch, never from a local branch.
2. **Only a human queues an item** (desktop action, or MCP from a session the
   human started). No auto-enqueue from tracker labels in v1. `runner.enqueue`
   carries the asking session as `origin_task` and refuses it when that task or
   an ancestor carries the `runner` tag. Imported item text always goes inside
   the untrusted block.
3. **Every terminal path frees the slot**: delivered, no changes, limit hit,
   stopped, error, dispatch failure, worktree failure, task deleted. The tick
   sweeps entries whose task is gone. This is ADR 0007 invariant 3 with N
   slots; a leaked slot wedges the runner.
4. **Mirror first, store after** (ADR 0007 invariant 1). Every write path,
   including tick sweeps, updates the in-memory queue.
5. **Nothing is re-dispatched on its own.** A lost agent parks the pipeline
   (ADR 0003); the entry keeps its slot and must appear in Needs you. That
   needs the pause barrier to say who paused it.
6. **Headroom never refuses a stage of an in-flight run**, and a 429 is never
   exhaustion or low headroom (ADR 0019 invariant 1).
7. **No PR without `Success { limit_hit: false }`, a non-empty change and, from
   Phase 2, passing checks.** A `request_changes` run is never delivered (ADR
   0001 invariant 4, carried one layer out).
8. **No `git`, `gh` or check command on the actor loop** (ADR 0002). Delivery,
   checks and reruns are spawned; the actor only edits its maps.
9. **Metrics are recorded at transitions, never derived later** from
   transcripts or task rows that retention deletes. Cost is USD-only and
   nullable.
10. **Auto-send and reopen are bounded and gated.** Each reopen passes the quota
    gate, counts `ci_rounds`, and never fires twice for one head commit plus
    check.
11. **Runner item state goes to the root checkout's backlog, never the
    worktree's copy.** In YAML mode a status write dirties the root's tracked
    files, and merge-back refuses a dirty base checkout (ADR 0015 amendment).
12. **New `Command` variants are wired into the chained dispatcher by hand**
    (CLAUDE.md, *Module layout*). A missed arm is a silent no-op. The runner
    avoids this with its own exhaustive `RunnerCommand`.
13. **The pipeline hook never starts a pipeline inline.**
    `runner_pipeline_finished` runs inside `workflow_finalize`; it queues a
    `RunnerCommand::Dispatch` instead of dispatching, so a finishing pipeline
    cannot re-enter the workflow engine from its own finalize.
14. **Test daemons never run `gh`.** The PR opener is injected
    (`RunnerCommand::SetPrOpener`); under `cfg(test)` the default refuses.
15. **The Factory never destroys user work in the project checkout.** It
    switches branches only on a clean tree and never stashes, resets, cleans
    or discards. A checkout it cannot give back cleanly stays where it is,
    held, with a reason a person can act on.
16. **The return point is on disk before the checkout moves.** The lease is
    persisted and flushed before the switch, so a crash at any point leaves a
    record of where to return.
17. **Give back only from the task branch.** A checkout that is no longer on
    the lease's branch belongs to the user again; the lease is released
    without a switch.
18. **A tracker sync never overwrites the status of an item with an active
    entry.** Sync resumes for that item once its entry ends.
19. **At most one checkout-located run per project.** The lease is the only
    thing that serialises checkout entries; `max_concurrent` counts every
    location, and a lease being prepared holds a slot.
20. **Checkout gates never hold worktree entries.** A dirty tree, a task
    running in the checkout, a YAML backlog or a lease in use marks only the
    checkout entry's `waiting_reason`; dispatch moves on to the next entry.
    A lease being prepared delays worktree starts until its switch ends; only
    a `Held` lease, which pauses the runner, stops them.

## Risks

- **Runaway cost.** Bounded by `max_concurrent`, `max_per_day`,
  `max_open_prs`, `max_rounds` (cap 5), `max_check_fixes`, `ci_rounds` and no
  retries. A USD cap is only enforceable for harnesses that report cost; for
  Codex only the counts hold. Subscription quota windows are the real budget,
  which is why headroom exists.
- **Flaky CI loops.** One rerun before a reopen, a per-commit watermark, and
  the `ci_rounds` cap. A check that flakes often shows in metrics and should be
  fixed or dropped, not fed to agents.
- **Conflicts between parallel items.** Nothing predicts file overlap before
  dispatch. Conflicts surface after merge order is decided, and each costs a
  fix-and-review round. Keep `max_concurrent` low on a small codebase; area
  labels (Phase 6) can serialise items that touch the same area.
- **Review quality without a human reading diffs.** Pipeline reviewers share
  training blind spots with implementers of the same family; configure
  cross-harness reviewers. The PR stays a draft for a human through Phase 3,
  and `max_open_prs` caps how much can be rubber-stamped. The rejected-PR rate
  is the metric to watch. The owner's own standard is that review means
  reading the code, and the runner does not change that.
- **Briefs.** Items are written as notes ("Sketch (M): …", "Investigate-only",
  "Spike"), not specs. A vague item burns a full pipeline. Queue only items
  whose body is a brief; the plan-review workflow's question barrier is the
  escape hatch. Investigate items end as `no_changes`, which is correct but
  not useful yet.
- **Disk.** A built worktree of this repo is ~15 GB. `min_free_gb` stops
  dispatch before the disk fills. Reclaiming artifacts at PR open and removing
  the worktree at merge return space. A clonefile seed or shared target dir
  (#81's remainder) is what makes `max_concurrent > 1` practical here.
- **Services and ports.** Worktree tasks share the project's service instances
  (#93). Checks that need running services cannot run in parallel, and two
  worktrees starting dev servers can collide on ports until each worktree task
  leases its own port.
- **First real load on untested paths.** Worktrees and workflows have barely
  been exercised (1 and 4 runs). Expect the runner to find their bugs; Phase 1
  with `max_concurrent: 1` is the shakedown.

## Phase 1 as built (2026-09-29)

Built to the file plan above. Where it differs, or where Phase 1 draws a line:

- **Settings** are per project: workflow, lead agent and model (a stage the
  template pins keeps its own agent; the runner does not override per role),
  `max_concurrent` 1, `max_open_prs` 3, `max_per_day` 10, `headroom_pct` 80,
  `min_free_gb` 25, and `running` (a new project starts paused). The wire
  accepts per-item workflow/agent/model overrides at enqueue; the desktop does
  not offer them yet.
- **Tracker-synced items.** The runner writes `in_progress`, `waiting`, `done`
  and `todo` to the item. While the item has an entry past `queued`
  (running, delivering, delivered), a tracker sync keeps that local status and
  refreshes the rest (`runner_active_items`, passed to `adopt_imported` and
  applied in `TrackerPersistSynced`); once the entry ends, sync owns the
  status again. The queue entry, not the item status, is what the runner acts
  on, and `Closes #N` makes the tracker agree after a merge.
- **A pipeline that ended while the daemon was down** is reconciled at boot and
  on every tick from the restored workflow run; an interrupted delivery is run
  again (commit, push and `gh pr create` are each safe to repeat).
- **`PullWatch` follows runner tasks even when archived** (`pull_status::targets`
  keeps `runner`-tagged tasks), so archiving a pipeline task does not leak an
  open-PR slot. Merge detection still needs the task: one deleted before its
  PR merges ends the attempt as `task_deleted` and sends the item to `todo`.

## Amendment — Run location, Stop, delivery in the summary (2026-09-29)

**Run location** is a per-project setting: `worktree` (default, as above) or
`checkout` (per item since the *Run location per item* amendment). Worktree tasks cannot use a verify stage (ADR 0024: services run
from the project checkout), so the Factory could not browser-test anything.
`checkout` runs one item at a time in the project checkout itself (the lease
serialises checkout entries; worktree entries may run beside one).

- **Before an item starts** (`actor/runner/checkout/`), on the loop: no lease
  is held, the backlog is not YAML (a YAML backlog is part of the checkout
  being switched, and status writes would dirty it), no task outside the
  runner is `Running` in the project checkout. Off the loop: no tracked or
  untracked change and no merge, rebase, cherry-pick, revert or bisect in
  progress. A refusal holds the queue with its reason and is re-checked on
  the tick, on Start and on enqueue.
- **The lease** (`runner_checkout` table, one row per project) records the
  item, the pre-chosen task id, the task branch `warpforge/task/<task id>`,
  and where to return: the branch, or the commit for a detached HEAD. It is
  written, and the persistence queue flushed, before the checkout moves.
- **Switch:** fetch origin's default branch, then `git switch --no-track -c
  <task branch> origin/<default>`, only if HEAD is still where inspection saw
  it. The pipeline is created with no worktree and the pre-chosen id;
  `base_branch` is the default branch, so delivery and `PullWatch` work as in
  a worktree (`PullTarget.head` names the task branch, because by the time
  the PR is polled the checkout is back on the user's branch).
- **Services** are not restarted. The running dev services serve the task
  branch through their own reload; a verify agent can restart one with the
  runtime tools. Restarting on the Factory's behalf would guess which services
  a workflow needs and interrupt the user's session for nothing on
  hot-reloading stacks.
- **Give back** runs whenever the entry leaves `running`/`delivering` —
  delivered, requeued by Stop, ended for any reason, task deleted — hooked in
  `runner_put_entry`/`runner_drop_entry` so no terminal path can miss it.
  Delivery commits first, so a successful run leaves a clean tree. The give
  back switches only from the task branch and only on a clean tree, then
  deletes the task branch when it has no commits of its own. HEAD elsewhere
  means the user took over: the lease is released and nothing moves.
  Otherwise the lease is **held**: the runner pauses, the reason is the
  project's hold, and the pipeline task is `Blocked` with it, which puts it
  in Needs you. Start retries the give back.
- **Restart:** leases are reconciled before the entry sweep. A lease whose
  entry is still running or delivering is kept; a held one stays held; any
  other is given back (a lease caught preparing either never switched —
  released — or did — switched back).

**Stop** (`runner.stop`): pause, then stop every running pipeline. Those
entries are requeued with `waiting_reason: "stopped by you"`, their item goes
to `todo`, and the attempt records `stopped`. Delivering entries finish.

**Delivery in the summary.** For a runner pipeline, `workflow_finalize` ends
the summary with a delivering note instead of "commit when ready"; when the
wrap-up reports, `runner_report_delivery` replaces the note in
`WorkflowRunInfo.report` with the outcome (draft PR number and URL, no
changes, or the failure) and posts it to the timeline. Manual pipelines keep
their text.

## Amendment — Run location per item (2026-09-29)

The project setting is now a default, and an item can override it. The owner
wants some items in a worktree and others, the ones that verify in the
browser, in the checkout.

- **Settings** gain `auto`: the checkout when the item's workflow has a verify
  stage, a worktree otherwise. `worktree` stays the default.
- **Entries** carry `run_location: default | worktree | checkout`, persisted
  in the entry JSON, set at enqueue (`runner.enqueue`, the desktop's Run in
  Factory dialog, MCP `runner_enqueue`) and editable while the entry is
  queued and no lease is preparing for it (`runner.setEntryLocation`).
  `runner::resolve_location` resolves it at dispatch from the entry, the
  setting and the loaded workflow. The entry records `resolved_location`
  while it runs, and `item_runs.run_location` keeps it for metrics.
- **Scheduling.** `effective_max_concurrent` is gone: `max_concurrent` bounds
  every in-flight entry whatever its location. Dispatch walks the queue in
  order; a worktree entry starts, a checkout entry starts only when
  `runner_checkout_refusal` (lease in use, YAML backlog, a non-Factory task
  running in the checkout, the last inspection's refusal) allows it and is
  otherwise skipped with the reason on its row. The project `hold` shows a
  checkout refusal only when it alone kept every queued entry back; slot,
  daily, open-PR and disk gates still hold the whole queue.
- **No worktree starts while a lease is `Preparing`.** Preparing fetches
  origin in the same repository a new worktree fetches in, and concurrent
  fetches race on `refs/remotes/origin/<default>`; a failed worktree creation
  costs an attempt, a failed preparation is retried. The switch dispatches
  again when it finishes.
- **Verify in a worktree** still parks (ADR 0024). The desktop warns at
  enqueue when the resolved location is a worktree and the workflow's verify
  stage is required (`WorkflowMeta.verify_required`); `auto` avoids it, an
  explicit `worktree` is kept.
- A `Held` lease still pauses the whole runner: it is a checkout a person has
  to clean up, and Start is the retry.

*Rejected:* a per-location concurrency pair (`max_worktree`, `max_checkout`).
The checkout limit is always one, and the lease already enforces it.

## Amendment — Factory as a task mode (2026-09-30)

The owner decided the Factory is not a place but a way to run a task. The
Factory tab on the project page is gone, and **Factory** is the third New Task
mode beside Single agent and Orchestrator; it absorbs the Workflow mode. Where
this amendment and the text above differ, this amendment holds.

**One mode, two deliveries.** Factory mode picks a workflow template (stage
chips, pinned agents from `WorkflowMeta.stage_agents`), *Test in the running
app* (switches to a template with a verify stage), where it runs
(Automatic / Background copy / Your project folder = `default` / `worktree` /
`checkout`) and **Open a draft PR when done** (default on when the project's
GitHub source resolves). PR on is the runner as described above. PR off is
ADR 0001's pipeline unchanged: nothing is committed or pushed.

**Entries are Factory tasks, keyed by task id.** The task row exists from the
moment a person asks, `Queued`, tagged `runner` and `workflow:<id>`, so it
shows in the sidebar while it waits; `workflow_create` starts the pipeline on
that same task id (`task_id` of an existing task is reused, not recreated).
`RunnerEntry` gains `task_id` (the key), an optional `item_id` (a prompt from
the dialog has no item), `deliver`, the session options and attachments, and a
structured `wait`. `ItemRun` gains `deliver` and the `completed` outcome (PR
off, pipeline succeeded). The store's queue key column is renamed
`entry_key`; rows keyed by an item are rewritten under their task at boot, and
a queued row that never had a task gets one.

**How tasks are created.** `task.create` with `workflow` and `factory:
{ deliver: true, runLocation }` creates a scheduled task (`RunnerCommand::
CreateTask`) and answers `{ taskId, started }`; PR off starts on the spot as
before. `runner.enqueue` makes one task per backlog item with one shared
`FactoryConfig` (the backlog's Start {n} in Factory and the Run in Factory…
batch, whose filter the client resolves to ids) and reports item by item:
`EnqueueResult { created[{taskId, itemId, started}], skipped[{itemId, number,
reason}] }` with `already_in_factory | closed | not_found | unreadable`.
`runner.brief` renders an item's prompt, tracker text inside the untrusted
block, for the dialog to prefill; the preamble is added only when the task
delivers.

**No running flag, no Start/Pause.** A request to start means "start when
allowed". `runner.stop` is *Stop all Factory tasks*: running pipelines stop
(their items go to `todo`), queued tasks are removed; nothing is requeued.
Per task: `runner.startNow` (past slots, open PRs, the daily cap, disk and
headroom — never an exhausted account, a held checkout or the checkout
checks), `runner.dequeue` (Remove from queue: the never-started task is
deleted), `runner.reorder` by task id, and `runner.retry` (**Run again**: a new
task with the last attempt's workflow, agent, model, location and delivery, or
what the task records when it had no attempt). `runner.setEntryLocation` and
the History list are removed.

**Waits are structured.** `RunnerWait` = `slots | open_prs | daily (next_at) |
quota (agent, account, window, used_pct, limit_pct, resets_at) | disk |
checkout_busy (cause dirty/operation/task_running/in_use/yaml_backlog/other) |
checkout_held | workflow_invalid | other`, on the project (`hold`) or on one
entry (`wait`). Clients word them; a queued task with neither is *next in
line*, which is not a wait. The desktop shows the project's hold first, since
the daemon judges it on every pass, then the task's own.

**Project folder without a PR runs in place.** Only a delivering task takes
the lease. A PR-off task in the project folder runs on whatever is checked
out, like a Workflow did, and counts as the one checkout run while it is in
flight.

**Held checkout.** A `Held` lease no longer pauses anything (there is nothing
to pause); it is the project's `checkout_held` hold, the task is `Blocked`
with `TaskBlockedKind::CheckoutHeld`, and Needs you offers **Try again**
(`runner.retryCheckout`) and **Open terminal**.

**Settings** are the project's Factory settings (project ⋮ menu): tasks at
the same time, pause at N open draft PRs, new tasks per 24 hours, keep N GB
free, pause when quota use passes N%, and the dialog's defaults (template,
agent, model, where it runs — default Automatic).

*Rejected:* keeping the Factory tab as a queue page next to the sidebar — two
lists of the same tasks, and the tab's Start/Pause state was the most
misunderstood part of the audit. Running PR-off tasks through the queue by
default — the old Workflow mode started on the spot, and the limits exist for
unattended PRs, not for a person watching a pipeline they just started. An
entry without a task (created at dispatch) — the queued work would be
invisible where people look for work.

### Invariants added

21. **A Factory task exists before its pipeline, and the pipeline starts on
    it.** Dispatch never creates a second task; `workflow_create` reuses a
    queued task's row and emits `task.updated`, not `task.created`.
22. **A queued Factory task has no session and is never prompted.** Every
    composer routes through `useWorkflowSend`, which refuses a Factory task
    without a run. The store reads queued tasks back as interrupted; boot puts
    back `Queued` only for tasks whose entry is still queued, and quit/update
    blockers do not count them.
23. **Only a delivering task switches the project checkout.** In-place runs
    never take the lease, and every checkout-located run, leased or not, is
    the one checkout run of its project.
24. **Start now never passes safety.** It skips slots, open PRs, the daily
    cap, disk and headroom only; an exhausted account, a held checkout and the
    checkout inspection still refuse.
25. **One Factory task per backlog item at a time.** Enqueue, the dialog and
    Run again skip or refuse an item with an entry, and say so.

## Phased plan

**Phase 0 — fixes the runner depends on** (all small): feedback dropped on a
finished pipeline's PR; `backlog_item_id` on workflow tasks; daemon-parked
pauses visible in Needs you.

**Phase 1 — MVP: queue items → draft PRs → done on merge.** New:
`daemon/runner/`, `actor/runner/`, `store/runner.rs`, protocol types, Run
action, Runner surface (queue and states), the `item_runs` row. Reused:
`workflow_create`, `StartPoint::fork`, `limits::gate`, `diff::{commit, push,
create_pr}`, `PullWatch`, `backlog` status writes, and the automation tick.
Success is the runner, with `max_concurrent: 1` on this repo, turning three
queued local items into three draft PRs with no manual step besides review,
and each merge flipping its item to `done`.

**Phase 2 — gates.** `checks:` in the workflow schema (`workflow_config/`),
the check barrier in `actor/workflow_stage.rs`, logs, checks in the definition
of done. ADR 0001 amendment.

**Phase 3 — PR loop.** Reopen transition, daemon watermark, Rust feedback
formatting, CI auto-send, rerun-once, `mergeable` and conflict reopen.
Amendments to ADR 0001 and ADR 0020.

**Phase 4 — merge.** Approve & merge when green; cleanup after merge.

**Phase 5 — metrics.** Stage rows, the `StageRecord` fields, the dashboard.

**Phase 6 — learning and cheap mode.** Labels, routing suggestions, the
single-plus-advisor pipeline choice, runner memory harvest, opt-in unattended
merge per kind.

Scale work runs beside Phases 2–4: worktree seed, per-worktree port lease,
reclaim at PR open, and #91's decision ledger before any project runs
`max_concurrent > 2`.

## Backlog items

Proposed; not created. Sizes: S ≈ a day, M ≈ a few days, L ≈ a week or more.

1. **Bug: "Send to agent" on a finished pipeline's PR drops the feedback** (S).
   `useWorkflowSend` returns `true` for a finished run with no barrier, so
   `PrFeedbackNotice` skips `session.prompt` and records the keys as handled.
   Short term: disable Send with a hint (open the fix stage) for a finished
   pipeline. Long term: item 11. Deps: none.
2. **Workflow tasks keep their backlog item** (S). `task.create` with
   `workflow` drops `backlog_item_id` before `CreateWorkflowTask`, so a
   pipeline parent is never linked back to its item. Thread it through
   `workflow_create` and persist it. Deps: none.
3. **Pause barrier says who paused it; daemon parks show in Needs you** (S).
   Add `reason: user | quota | agent_lost` to `RunState::Paused` (serde
   default `user`). `attentionRail` hides only `user`. A slice of #91. Deps:
   none.
4. **Backlog runner core** (L). `daemon/runner/` (ordering, slots, state
   machine, headroom, brief), `actor/runner/`, `store/runner.rs`
   (`runner_settings`, `runner_queue`, `item_runs`), protocol, enqueue, dequeue,
   reorder, pause, stop, and the runner tick on the automation timer. Dispatch
   via `CreateWorkflowTask` with worktree, fork from the fetched remote default,
   and the pre-dispatch gate (all stage agents, headroom, disk floor). Deps: 2,
   3.
5. **Runner delivery: commit, push, draft PR** (M). Hook `workflow_finalize`.
   Refuse an empty change, commit on the task branch, push, open a draft PR
   with the item link, summary, deferred findings, rounds and cost. Record it
   on the entry and register with `PullWatch`. Delivery failures end the run
   visibly. Deps: 4.
6. **Runner PR outcomes close the item** (M). Start `PullWatch` polling from
   the daemon for runner tasks. On merged, set the item `done` and record
   `merged_at`; on closed, send the item back to `todo` and mark the run
   rejected. Push a runner event so the surface updates. Deps: 5.
7. **Desktop: Run action and Runner surface** (M). Run and bulk Run on backlog
   rows and the drawer, with workflow and lead agent/model overrides. A project
   surface with queue order, entry state, PR link, and runner pause/stop, plus
   per-project settings (concurrency, caps, headroom, disk floor). Docs page in
   `www`. Deps: 4.
8. **MCP: runner_enqueue and runner_status** (S). Let an orchestrator
   chat fill and read the queue instead of driving the loop itself. Same
   project scoping as the backlog tools. Deps: 4.
9. **Workflow checks before review rounds** (M). Optional `checks:` (name,
   command, timeout) in the workflow YAML. They run after implement and each
   fix; a failure feeds the fix stage as findings instead of starting a review.
   `max_check_fixes` cap, full logs, and passing checks as part of run success.
   ADR 0001 amendment; supersedes #94's investigation. Deps: none (runner
   optional).
10. **Record check failures vs review findings per run** (S). Write both to
    `item_runs` so #94's question is answered with data after a few weeks.
    Deps: 4, 9.
11. **Reopen a finished pipeline with external findings** (M). A `Done` run
    goes back to Fix → Review → Done with CI, conflict or PR-remark findings,
    with its own `ci_rounds` counter, keeping take/put and round invariants.
    Also the right fix for item 1. ADR 0001 amendment. Deps: none.
12. **CI auto-send for runner tasks** (M). Daemon watermark keyed by head
    commit + check, the prFeedback formatting ported to Rust with the untrusted
    block, one `gh run rerun --failed` before reopening, quota-gated,
    `ci_rounds` cap. ADR 0020 amendment (invariant 7). Deps: 6, 11.
13. **Conflict handling for runner PRs** (M). Add `mergeable` to the PR
    listing. `CONFLICTING` reopens with a finding: merge the remote base in and
    resolve, then review. No rebase, no force-push. Deps: 11.
14. **Approve & merge when green** (M). An in-app approval pinned to the head
    commit; merge with `gh pr merge --squash` once checks pass and the PR is
    mergeable; a new push voids the approval. Worktree cleanup through
    `removal_blocker` after merge. Deps: 6.
15. **Runner stage metrics** (M). `item_run_stages` rows with agent, model,
    times and cost snapshotted at stage end via `spend::sum_runs`. Add `model`
    and timestamps to `StageRecord` with `serde(default)`. Deps: 4.
16. **Runner metrics dashboard** (M). Throughput, cost per merged item, rounds,
    success and rejection per agent/model, time to PR, PR to merge, CI rounds,
    with n on every figure and "not reported" for Codex. Deps: 15.
17. **Labels on backlog items** (M). Import tracker labels and allow local
    ones on the normalized item (both storage modes). Filter by label. The
    runner reads one as the item's kind. Deps: none.
18. **Routing suggestions at enqueue** (M). For the item's kind, suggest the
    lead agent/model with the best rejection-adjusted success and cost once n ≥
    10, and show why. Never switch silently. Deps: 16, 17.
19. **Single agent + advisor as a runner pipeline** (M). A cheap mode for
    small items: one executor with an advisor (ADR 0022) and workflow checks as
    the definition of done, delivered through the same path. Deps: 5, 9.
20. **Runner source for memory harvest** (S). At merge, propose the fixed
    findings and the implement stage's recorded assumptions into the memory
    approval queue. Deps: #83, 6.
21. **Worktree seed: clonefile build dirs or shared target dir** (M). The
    remainder of #81: `seed:` entries copied with `cp -c` / reflink, or a
    per-project shared `CARGO_TARGET_DIR` for runner worktrees. Measure wall
    time and real disk delta first. Deps: none.
22. **Reclaim at PR open, remove at merge for runner worktrees** (S). Reuse
    `worktree/reclaim.rs` and the ADR 0020 removal path, opt-in per project.
    Deps: 6.
23. **Lease an idle port to each worktree task** (S). #93 phase 0: name it in
    the preamble so parallel agents and checks do not collide. Deps: none.
