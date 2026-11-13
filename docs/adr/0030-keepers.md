# 0030 — Keepers: post-agents that keep a task's change green, before and after its pull request

**Status:** proposed (2026-11-06) — draft · backlog #145; prerequisite #146;
editing UI #147 · amends [0020](0020-task-pull-request-status.md), replaces
Phase 3 of [0023](0023-backlog-runner.md)

## Context

A task's change is checked today in three disconnected ways. A workflow
pipeline (ADR 0001) reviews and fixes, but only inside a Factory task whose
parent has no session. An advisor (ADR 0022) answers when the executor
chooses to ask. After **Open pull request**, failing checks and unresolved
review threads come back into the task (ADR 0020), and a person has to press
**Send** for the agent to hear about them. Nothing checks an ordinary task's
commits on its own, and nothing reacts to CI while the owner looks elsewhere.

In every agent tool today, this one included, the person is the sensor of
every loop: they read the diff, notice that CI went red, and carry a
reviewer's comment back to the agent. More agents means more of their
attention. On 2026-11-06 the owner chose to move that sensing into the
product. **Keepers** are agents attached to a task that check its change and
loop with a fixer until it is green. The owner decides what must hold for a
change and handles only what the loop cannot settle.

The inspiration is Entire's managed agents (Code review / Security review /
Slop, each with harness, model, effort, time limit, instructions, a pass/fail
result where lower is better, run on every push once a change is ready for
review). Building what Entire already has is deliberate: a loop next to the
task, its agent and its running services beats a separate site. Entire is a
forge and replaces the pull request. Warpforge runs on one developer's machine
on top of the team's GitHub, so teammates install nothing and the pull request
stays.

The product shape (the first section below) was settled with the owner; the
rest of this record is mechanics.

What exists and what this record builds on:

- **Workflow review protocol.** Fenced JSON verdicts, parsed by
  `extract_last_json_with_key` (`src/daemon/workflow/parse.rs:146-168`) and
  `parse_review_verdict` (`:26-68`); `Finding` and `Severity`
  (`src/daemon/workflow/mod.rs:148-199`), where Low never goes to fix
  (`:166-168`). The verify verdict `pass | fail | blocked` (ADR 0024,
  `workflow/verify.rs`).
- **The workflow engine assumes it owns every session it routes.** The parent
  is a session-less record (`src/daemon/actor/workflow.rs:192-193`); implement
  and fix always spawn a new child (`src/daemon/actor/workflow_stage.rs:199-218`);
  any non-interrupted turn of a routed child is a stage result
  (`src/daemon/actor/acp_update.rs:232-237`). Reviewers read `working_diff`,
  tracked plus untracked changes (`src/daemon/diff/working.rs:112-120`), which
  is empty right after a commit.
- **Hidden read-only child task.** The advisor (`src/daemon/actor/advisor/`):
  `origin` keeps it off boards (`src/daemon/task.rs:100-103`), it records no
  worktree and works in the executor's checkout (`advisor/mod.rs:148-152`),
  read-only in four places (`advisor/mod.rs:157-261`,
  `src/mcp/tools/advisor.rs:6-19`), cost by running-cost delta
  (`advisor/answer.rs:61-76`), deleted with its executor (`advisor/mod.rs:277-315`).
- **Pull request cache.** `PullWatch` (`src/daemon/pull_status/mod.rs:69-75`):
  a 180 s loop over open and draft PRs (`:30-31`, `:293-320`) that starts only
  after a client's first refresh (`:329`); remarks re-read when `updatedAt`
  moves or after 15 min (`:36-37`, `:216-255`). The listing's fields
  (`pull_status/gh.rs:20`) carry no `mergeable` or base branch. The wire entry
  has `failed_checks`, `open_comments`, `head_oid`
  (`crates/warpforge-protocol/src/pulls.rs:233-257`).
- **"What the agent was told" lives per device**: `store/prFeedback.ts`,
  localStorage `wf-pr-feedback` (`desktop/src/store/prFeedback.ts:32-36`), keys
  `check:<head>:<name>` and `thread:<root>:<latest non-author comment>`
  (`desktop/src/lib/prFeedback.ts:33-45`). ADR 0020 rejected a daemon
  watermark and deferred auto-send because it would need one.
- **GitHub writes already exist** in the PR inbox: thread replies through
  `addPullRequestReviewThreadReply` (`src/daemon/tracker/github/pulls/comment.rs:91-110`),
  PAT over REST/GraphQL, else `gh`. The connected login shown to the user comes
  from `gh api user` even when a PAT is set (`src/daemon/tracker/mod.rs:179-182`),
  while `viewer_login` asks the PAT (`tracker/github/pulls/mod.rs:122-148`).
  Push is `diff::push` (`src/daemon/diff/remote.rs:265-298`). No CI rerun code
  exists.
- **Nothing notices a commit.** Agents commit from their own shell. The
  Explorer watcher batches git-state changes but its `FsChanged` event drops
  `git_changed` (`src/daemon/explorer/watch.rs:283-289`), it lives only while a
  client holds a lease, and a branch commit moves a ref in the common `.git`,
  not in the worktree's git dir. No git hooks are installed.
- **Turns.** One outstanding prompt per session; the driver owns the queue
  (`src/daemon/acp/session/turn.rs:43-90`); `TurnInitiator`
  (`src/daemon/acp/mod.rs:53-64`) has no keeper value.
- **UI.** Surface tabs are Explorer, Diff, Runtime, Terminal, Browser,
  Pipeline (`desktop/src/components/workspace/SurfaceTabs.tsx:30-42`). The
  sidebar row's PR glyph is `TaskPullRequestGlyph` (`SidebarTaskRow.tsx:153-155`)
  beside a fixed 68 px meta lane (`:174-197`). Mission Control's tiles show no
  PR state; PR feedback reaches it only as an attention reason
  (`desktop/src/lib/attentionRail.ts:135-138`).
- **Naming.** "keeper" occurs in `src/daemon/memory/dream.rs:23` only in a doc
  comment (the duplicate kept by a compaction); no identifier uses it.

## Decisions

### Product shape

**The unit is the task and its pull request.** One task is one PR, and a
keeper belongs to the task. *Rejected:* a change object that replaces the PR,
as Entire's Trails do. Entire is the forge, so a team moves to it together.
Warpforge is one developer's tool inside a team; the PR is the team's
contract, and replacing it would need every teammate to switch.

**Keepers attach to a task that owns a branch.** A worktree task owns its
worktree's branch, so its commits and its PR are unambiguously its own. A
project-folder task shares the project's checkout with every other folder
session, so it owns a branch by committing on it: when a turn of the task
ends and the checkout's HEAD moved during that turn (or Warpforge committed
for it), the checkout's branch is the task's, unless it is the base branch,
the remote's default, `main` or `master`. Claiming it releases it from any
other folder task of the project, so the session that committed last is the
one its keepers report to. A turn that moved no HEAD claims nothing: an
orchestrator's turns end constantly and would otherwise take the branch from
the sub-agent whose commit it is. Attribution also happens at the poll, not
only at a turn end: when the checkout's HEAD moved and exactly one folder
task of the project is mid-turn, and its turn began on another HEAD, that
task is the committer and claims the branch at once, and its own turn holds
the check until it ends, so the findings and the fix go to the session that
wrote the commit. A turn's starting HEAD is read from the checkout when the
turn starts, not taken from the last poll, which can be 20 s old: an
orchestrator woken by a sub-agent's report would otherwise look like the
author of the sub-agent's commit. Several
mid-turn tasks leave the author ambiguous, so the new HEAD is not checked
until at most one is running; nobody running means a hand commit in a
terminal, and the current owner keeps the branch. A task that loses its
branch has its open findings superseded — the new owner's next check reads
the whole branch diff and reports anything still true. A branch no
folder task owns goes, at the next poll, to the project's most recently
updated folder task that owns no branch yet — so switching to a branch and
adding keepers starts them without waiting for a turn, while a task that
already owns a branch pauses rather than following the checkout to someone
else's branch. Its keepers check
only while the checkout is on that branch; on another branch or the base they
are paused with the reason, and they resume when the checkout returns. A fix
also waits while any other folder session of the project is mid-turn, since
both write the same tree. *Rejected:* attributing commits by a per-session
trailer or author — it needs every harness to cooperate, and a keeper checks
the branch's whole change anyway, not single commits. *Rejected:* modelling a
change as "commits that reached main", with the PR optional. That fits this
repository, which goes straight to main only because it has one maintainer,
and no team.

**A keeper stops at merge.** What outlives the change is a committed test
(Verify asks for one) and the task's read-only record. *Rejected:* keeping a
merged change's checks running as guards on main. Checks that are tests
already run in CI. Agent-run checks repeated for every merged change cost more
with each change and rarely fire. A regression is usually caused by a later
change and belongs in a new task. Drift without commits (CVEs, performance,
file size on main) belongs to no single change, so it is work for automations
and Smiths, which open new tasks.

**The name is "Keepers", a role next to Smiths.** Smiths make; keepers keep
the change green. The UI lists them by name ("Keepers: Review · Security ·
Slop"), because a compound like "slop keeper" reads as a keeper of slop.
*Rejected:* "traits" (it came from misreading Entire's "Trails"; a trait is a
characteristic, and to developers a Rust, Scala or PHP construct); "checks"
(it names no role, and collides with GitHub's checks shown in the same
places); "guards" (it reads as guardrails on the agent itself); "hallmarks"
(too rare a word to be understood at a glance).

### Definition

**A keeper is a YAML file, `.warpforge/keepers/<id>.yaml`; the file stem is
the id.** Same discovery rules as workflows (`src/workflow_config/registry.rs`):
`.yaml`/`.yml`, first stem wins. Schema, version 1:

```yaml
version: 1
name: Review                 # shown in the UI; one or two words
description: Bugs, regressions and edge cases in the change.
preset: review               # optional: inherit a built-in's prompt and defaults
when: commit                 # commit | ready | ci | comments
result: findings             # findings | pass_fail | verdict | draft
agent: claude                # optional; else the task's agent
model: opus                  # optional
effort: high                 # optional; passed as the agent's effort override
time_limit: 15m              # checker turn deadline, default 15m, cap 60m
max_rounds: 3                # fix rounds before asking the owner, cap 5
min_severity: medium         # findings below this are shown, never sent to fix
default: on                  # on | off for new tasks in this project
paths: ["src/**", "!**/*.md"] # optional: run only when the change touches these
instructions: |              # appended to the preset prompt, or the whole prompt
  …
```

A file with `preset:` and no `instructions` is the built-in; `instructions`
add to it; `prompt:` replaces it. Unknown keys warn, as in workflows
(`src/workflow_config/parse.rs:125-162`).
*Rejected:* one `keepers.yaml` listing all keepers — every edit conflicts with
every other, and the UI (#147) would rewrite unrelated entries. *Rejected:*
keepers as reviewers inside workflow files — workflows run only in Factory
tasks; keepers attach to every task.

**Presets ship in the binary and are off until a project adds them.**
`src/keepers/*.yaml`, `include_str!` like `BUILTIN_WORKFLOWS`
(`src/workflow_config/mod.rs:49-59`). **Add keeper** writes a two-line file
(`version`, `preset`) into the project. A preset that no file names never
runs. *Rejected:* built-ins on by default — unasked token spend on every commit
of every task, the opposite of what ADR 0019 protects.

**Per-task switches live on the task, in the daemon.** `Task.keepers:
Option<TaskKeepers>` (`serde(default)`) holds overrides `{ keeper_id: on|off }`
on top of each file's `default`. The New Task dialog and the keepers section
set them. *Rejected:* in the YAML — task ids are local and the file is the
team's. *Rejected:* in localStorage — the daemon must know unattended.

**A Smith-backed keeper is a local binding, not a YAML field.** The owner binds
a keeper id to a Smith on this machine (`keeper_bindings`: project, keeper id,
smith id). The checker session then runs as that Smith (soul, constitution,
journal; ADR 0027) and its dismissed findings are written to the Smith's
journal, so later tasks start knowing what the owner rejected. Unbound, the
keeper runs as configured and remembers dismissals only within the task.
*Rejected:* `smith: Ada` in the YAML — Smiths are per user and outside the
repo by design (ADR 0027), so the same name means a different agent, or none,
on a teammate's machine.

### Where state lives

**Runs and findings are daemon state: an actor mirror, written behind to two
tables** (ADR 0007's pattern). `keeper_runs` (task id, keeper id, run number,
trigger, head sha, base sha, started/finished, outcome, count, checker task
id, round, cost, error) and `keeper_findings` (run id, key, severity, file,
line, description, status `open | sent | fixed | dismissed | superseded`,
dismiss reason). The mirror is a per-task `KeeperState` map loaded at spawn;
every mutation writes the mirror first, then `Persist`. Clients get
`keepers.state` on request and `task.keeper { task_id, keeper_id, … }` pushed
on change, stamped like `task.pullRequest` (ADR 0020 invariant 3). Rows are
deleted with the task and kept while it is archived: a merged task's keeper
history is part of its read-only record.
*Rejected:* a field on the persisted `Task` — every strip update would persist
and re-broadcast the whole task (ADR 0020's reason for `PullWatch`).
*Rejected:* inside a `WorkflowRun` snapshot — there is no run for an ordinary
task, and the snapshot is one JSON blob rewritten whole.
*Rejected:* derived from transcripts — retention prunes them (ADR 0023
invariant 9).

**Precision is computed from findings, per keeper id per project.**
`precision = fixed / (fixed + dismissed)` over the last 50 resolved findings,
shown with its sample size. *Rejected:* a stored counter — it cannot be
recomputed when a finding's status is corrected.

### Trigger

**The daemon polls each eligible task's HEAD, off the actor loop, and checks
at once when a turn ends.** Eligible: a task, not done or archived, with at
least one `when: commit` keeper on. Every 20 s one spawned task runs
`git rev-parse HEAD` per eligible task's checkout, then, for a folder task,
reads the checkout's branch (bounded concurrency,
results sent to the actor as one command). A `TurnEnded` of the task's own
session and a `git.commit` RPC request an immediate check.
*Rejected:* a `post-commit` hook — it must be written into the repository's
hooks directory or `core.hooksPath`, which projects own (this repo sets
`.githooks`); worktrees share it with the main checkout; and a hook firing
into the daemon is a second channel to authenticate (#120).
*Rejected:* the Explorer watcher — it exists only while a client holds a
lease, drops `git_changed`, and does not watch the common `refs/` a branch
commit moves. A dedicated watcher on `refs/heads/<branch>` plus `packed-refs`
plus each worktree `HEAD` would work, but costs file handles per task and
still needs the poll as a fallback after sleep. A `rev-parse` every 20 s is a
few milliseconds.

**Debounce: a commit is checked once it has settled.** A new HEAD starts a
run when all hold: HEAD differs from the last checked sha; it has not moved
for 60 s, or the task's turn just ended; and the task is not mid-turn. An agent
committing five times in one turn produces one run, on the last commit. A
HEAD that moves while a run is in flight marks that run `superseded`: its
findings are kept for display and never sent to a fixer.

**A keeper checks committed work only.** It reads `git diff <merge-base>..HEAD`
against the task's `base_branch` (the change the PR will show) plus the list
of commits since its previous run. The working tree is ignored.
*Rejected:* `working_diff` — empty after a commit, and a half-typed edit is
not a change anyone asked to check.

**`when: ready` runs on an explicit action.** "Check before PR" in the keepers
section, and opening the Create PR dialog, run every `ready` keeper on the
current HEAD. The dialog shows their state and takes PR-ready's draft as the
description. It never blocks creating the PR: the owner may open it red.
An explicit check re-runs a ready keeper even on a HEAD it already checked,
but never one still running. Ready keepers past the cap of four checkers
queue and start as checkers finish. Their findings join the commit keepers'
fix prompt for that HEAD; after the fix, nothing re-checks a ready keeper
until the owner asks again, and a ready run is not marked superseded when
HEAD moves — the fix gate's HEAD check already keeps it from feeding a fix.
A folder task asking for a check adopts the checkout's branch when no other
folder task owns it; otherwise the request is refused with the held reason.

### Mapping onto tasks and the engine

**The checker is a hidden, read-only child task, one per (task, keeper).**
`origin: "keeper"`, tag `keeper:<id>`, `parent_task_id` = the task, no
`worktree`, cwd = the task's worktree (the advisor's `advisor_cwd` rule). It
gets the advisor's four read-only enforcements and its bridge mode, plus the
runtime and browser tools for Verify. Later runs re-prompt the same session
(ADR 0001 `reask: same_session`), so the checker can verify its own earlier
findings; a dead session falls back to a fresh one given those findings.
Deleting the task deletes its checkers. A checker whose agent or model no
longer matches the keeper's file, or one that is blocked, is deleted at the
next run and a fresh one replaces it: a saved session cannot be loaded by
another harness. *Rejected:* one checker session for
all keepers of a task — the roles would share context, which ADR 0001 rejected
for reviewers.

**A new small engine, reusing the workflow's parts, not `WorkflowRun`.**
`src/daemon/keepers/` (pure: state, prompt rendering, verdict mapping) and
`src/daemon/actor/keepers/` (glue), with its own exhaustive `KeeperCommand`
enum. It reuses `workflow::parse` (both verdict fences), `Finding`,
`Severity`, the template renderer and `limits::gate`.
*Rejected:* a `WorkflowRun` per keeper with the task as parent — the parent
must have no session, cancelling it stops the run, implement and fix always
spawn their own children, and every user turn in the task would be read as a
stage result (`acp_update.rs:232-237`). Bending those rules would break
ADR 0001's invariants for Factory tasks to serve a different shape.

**Factory tasks are out of v1.** Their pipeline already reviews, and their
parent has no session to fix in. Post-PR keepers on Factory tasks reuse
ADR 0023 Phase 3's reopen transition (fix → review in the same worktree) as
their fixer; that wiring lands in the post-PR phase.

### The fixer

**The task's own session fixes.** Findings at or above `min_severity` from
every keeper that finished on the same HEAD are merged into **one** fix
prompt, sent into the task's session with a new `TurnInitiator::Keeper`. The
prompt says: fix or rebut each finding, change nothing else, run the project's
checks, commit, never `--no-verify`, do not push. The commit it makes is the
next trigger, which is the recheck.
*Rejected:* a fixer child task — a second writer in the same worktree, racing
the task's agent and the user, without the brief and the conversation that
explain why the code is the way it is. ADR 0001 uses a child only because its
parent has no session.
*Rejected:* letting a keeper edit the code itself, even Slop, whose fixes are
mechanical. The checker stays read-only; Slop's findings go to the fixer
without a severity floor instead.
*Rejected:* `TurnInitiator::System` — the transcript and Mission Control must
say "Keepers asked", and `Keeper` turns, like `System`, are never batched
into a force-send (ADR 0011).

**Send to agent is the owner's manual fix.** The automatic loop sends findings
only while they are on the HEAD it is fixing, so a ready keeper's findings are
lost to it once anyone commits again, and a keeper the owner accepted has no
way back. A task that lost its branch is not one of these cases: its findings
are superseded, and the branch's new owner's next check reports what still
holds. The Keepers tab's **Send to
agent** (`keepers.sendFindings`) sends one keeper's open findings of its
latest counted run as one `Keeper` fix turn, whatever HEAD they were found on:
the owner has read them and decides they still matter. The prompt names the
commit they were found on and asks the agent to check each one still holds
before fixing it. It skips the HEAD match and the folder task's branch claim,
but not invariant 20, and it never waits and never interrupts: it is refused,
with the reason, while the agent is mid-turn, a `User` prompt is queued, a fix
is already sent, the task has no session to resume, the account is refused, or
nothing is open. Tracked changes in the worktree do not refuse it, the one
exception to invariant 3: in a shared checkout the tree is rarely clean, and
the owner asked, so the prompt instead tells the agent the changes are not its
own and to commit only the files it changes, staged by path. Staging by path
cannot separate two people's edits in one file, so a send is refused while a
file one of its findings names has uncommitted changes. It is a round
like an automatic fix (invariant 5): counted once per HEAD, reverted when the
turn is cut short or the prompt is not delivered, and it clears a stop, since
sending is the owner's answer to it.

### Concurrency with the user's own work

**A fix prompt waits for a quiet task.** It is dispatched only when the
task's session is not mid-turn, has no queued `User` prompt, and the worktree
is clean (`git status --porcelain --untracked-files=no` empty: an untracked
file is nobody's edit in progress, and the keeper files **Add keeper** writes
start untracked). A session that is not live but can be resumed counts as
quiet: the fix prompt resumes it, as a user prompt would. Otherwise the
keeper shows "waiting" with the reason and retries on the next `TurnEnded` or
poll. A dirty tree means someone is editing; mixing a fix into it would
commit their half-done work.

**The user always wins a race.** A message sent during a keeper's fix turn
queues behind it as today; force-send interrupts it. An interrupted keeper
turn feeds nothing (ADR 0011 invariant 3), does not count a round, and the
findings stay `open` for the next run.

**Checkers run in parallel; fixes do not.** All keepers due on one HEAD start
together, capped at four checker sessions per daemon (the `PullWatch` limit).
Their results are merged into one fix turn when the last one finishes or
times out.

### Result model

**Every run ends in one of five outcomes**, whatever the result type:
`green`, `findings(n)`, `inconclusive` (verify's `blocked`, a timeout, an
unparseable verdict after one re-ask), `error` (the session failed to start),
`skipped` (quota, `paths` did not match, superseded).

| `result` | Protocol | Maps to |
| --- | --- | --- |
| `findings` | review fence | n findings ≥ `min_severity`; 0 = green |
| `pass_fail` | review fence | `approve` = green; else findings |
| `verdict` | verify fence | pass = green, fail = findings, blocked = inconclusive |
| `draft` | closing message | text for the owner; never green or red |

Lower is better; zero is green. There is no "higher is better" setting: no
preset needs it. *Rejected:* a raw score — it has no fixer action attached.
*Rejected:* a new protocol — both fences, their parsers and their fallbacks
already exist and are tested (ADR 0001 invariants 3–5).

**Dismissal is the owner's verdict on a finding.** "Dismiss" (optional reason)
sets `dismissed`, removes it from the next fix prompt, and lists it in the
checker's next prompt as "the owner rejected these; do not raise them again".
It counts against precision. A finding the next run no longer reports after a
fix becomes `fixed`.

**The agent's reply is advice; only the owner resolves.** Both fix prompts
number the findings and ask the agent to end with one json fence that lists
the ones it did not fix: `rebutted` (not a real problem) or `stale` (no longer
holds), each with a reason. When the fix turn ends, the daemon reads the last
fence of its closing message, maps each number back to the finding the prompt
carried, and records the answer as the finding's `reply`; a malformed fence
records nothing and never fails the turn. The status stays `sent`. When the
turn also commits and the next run raises an answered finding again, the new
finding inherits the reply, and the automatic fix skips answered findings:
they wait for the owner instead of looping toward `no_progress`. **Accept**
(`keepers.acceptReply`) is the owner's verdict: a rebuttal becomes a Dismiss
with the agent's reason, so it counts against precision and the checker is
told not to raise it again, and a stale finding becomes `fixed`. To reject a
reply the owner sends the findings again: Send to agent takes the answered
ones with the open ones, and a new hand-over clears their replies.
*Rejected:* applying the agent's verdict directly — the fixer would grade the
keeper that checks it, and precision would measure the agent's opinion.

**The strip is per run.** The keepers section shows, per keeper, its state
(off / running / green / findings / waiting for you) and the last ten runs as
cells: green, red with the count, grey for inconclusive or skipped.

### Post-PR

**The watermark moves into the daemon.** `keeper_reactions` (task id, key,
action, at) with ADR 0020's keys. The desktop reads handled keys from
`keepers.state` and stops writing `wf-pr-feedback` for tasks with a post-PR
keeper on; manual **Send** and **Dismiss** become daemon RPCs that write the
same table. ADR 0020 rejected this because only the clicking surface produced
the fact; now the daemon produces it too, and two stores would send the same
failure twice. It also means one record across devices. ADR 0020's
"per device" decision and invariant 7 are amended: only a click **or an
enabled post-PR keeper** sends feedback to an agent.

**`PullWatch` gains three fields and starts at spawn.** The listing adds
`mergeable,mergeStateStatus,baseRefName` (same `gh pr list` call,
`pull_status/gh.rs:20`). The 180 s loop starts when the daemon starts if any
task has a post-PR keeper, instead of on the first client refresh. Cadence
stays 180 s; the remarks gate stays (a new comment moves `updatedAt`).
*Rejected:* a faster loop or webhooks — the daemon is local and has no public
endpoint; CI takes minutes anyway.

**CI keeper.** On `checks: failing` for the head that equals local HEAD:

1. An Actions failure not yet rerun for (head, check) is rerun once —
   `gh run rerun <id> --failed`, the id validated as digits — and recorded as a
   suspected flake with the first run's link. Only a repeat on the same head
   reaches the fixer.
2. A failure that the same check also has on the base branch's latest run is
   not fixed here; the keeper merges the base into the branch and waits.
3. Otherwise the fix prompt carries the check names, links and the
   `--log-failed | tail -n 80` command (ADR 0020's rule: say where, do not
   paste).
4. After the fix turn the daemon, not the agent, pushes: plain `git push`, no
   force, hooks run. A fix whose diff touches a test file (`paths` of the
   project's test globs, default `**/*test*`, `**/*spec*`, `tests/**`) parks at
   "waiting for you" with that diff; push happens on approval.

`mergeable: CONFLICTING` → a fix prompt to bring `origin/<base>` into the
branch and resolve it, with the project's strategy: `keepers.conflicts:
rebase | merge` in the project's keepers settings, default `rebase`. A rebase
is pushed with `--force-with-lease` pinned to the head GitHub reported, never
a bare `--force`; a merge is a plain push. *Rejected:* one fixed strategy
(ADR 0023 chose merge) — teams and even repositories differ, so it is the
project's choice. ADR 0023 Phase 3's merge-only rule is superseded here.

**Team comments keeper.** For each unresolved thread or change request whose
key is not in the watermark, the checker classifies: `change_request` (one
clear instruction, no reviewer disagreeing in the thread), `question`,
`discussion`, `disagreement`. A change request goes to the fixer; after the
push the daemon replies in the thread, `Fixed in <short sha>.` A question,
discussion or disagreement produces a reply **draft** shown in the keepers
section; the owner edits and sends it through the existing
`tracker.pulls.comment`, or dismisses it. Nothing but "fixed in" is ever
posted unattended.

**Only collaborators' requests are fixed unattended.** A thread counts as a
change request only when the comment asking for the change is by a person
whose `authorAssociation` is `OWNER`, `MEMBER` or `COLLABORATOR`. Bots, and
outside or first-time contributors, always get a draft, whatever they ask.
*Rejected:* trusting any reviewer. On a public repository anyone can comment
on a pull request, and a clear instruction from a stranger would be
implemented and pushed under the owner's name.

**GitHub identity is the owner's, and is resolved once.** Pushes use the
checkout's git credentials; replies use the tracker path (PAT, else `gh`).
Before the first unattended write the daemon resolves the writing login with
`viewer_login` (the PAT's `/user`, else `gh api user`) and refuses to act when
it differs from the PR's author: the thread key ignores comments by the PR
author, so a reply under another login would re-raise its own thread.

**With the laptop closed nothing reacts.** The daemon runs only while the app
does (ADR 0014). On wake the first poll sees the current state and the
watermark makes each fact one reaction; a failure on a head that has since
moved is ignored by key. A PR whose GitHub head differs from local HEAD (a
teammate pushed, or a push is still pending) is not acted on; the keeper
shows "waiting: branch moved on GitHub".

**Post-PR unattended work waits for four layers.** It reads text anyone can
write and then pushes under the owner's name. An agent with an unsandboxed
shell running as the owner's macOS user needs no daemon to do harm: git and
`gh` credentials, the daemon's token file and the shell profile are all
readable, so no single layer below is a defence on its own.

1. **Untrusted text reaches only the checker, which has no shell and no
   writes.** GitHub text stays inside `<github_untrusted>`, formatted in Rust
   (ADR 0020 invariant 8, ADR 0023 Phase 3). A read-only checker with a shell
   is not read-only.
2. **The fixer never sees raw GitHub text.** It gets a structured request the
   daemon built from the checker's classification, and only for
   collaborators' change requests.
3. **The task's agents run in their harness's OS sandbox**, denied
   `~/.warpforge`, `~/.ssh` and the `gh` token store, with network on an
   allowlist. This is the real boundary.
4. **#120:** the bridge gets a scoped credential and is refused user-only
   methods, so a sandboxed agent cannot use its legitimate channel to the
   daemon to act as the owner.

These apply only to tasks with a post-PR keeper on; tasks without keepers run
exactly as before.

**Merge ends it.** When `PullWatch` reads `merged` or `closed`, every keeper
on the task stops, checker sessions are stopped, pending fix prompts are
dropped, and the section becomes read-only. Checks worth keeping become
committed tests (Verify asks for one). Drift on main belongs to automations
and Smiths, which open new tasks.

### Cost, stop rules, escalation

- **Quota.** Every checker start and every fix prompt goes through
  `dispatch_refusal` (ADR 0019) on the account the session will use. A refusal
  is `skipped (quota)` and the keeper waits; it is retried on the next poll,
  not counted as a round.
- **Time limit.** The checker turn is cancelled at `time_limit`; the run is
  `inconclusive`.
- **Rounds.** A round is one fix turn. `max_rounds` (default 3) counts fix
  rounds per keeper since its last green, and increments only when the fix
  prompt is handed to the session.
- **No progress.** Two runs in a row with the same or more findings ≥
  `min_severity`, or a finding the fixer rebutted and the checker raised again,
  stop the loop.
- **Escalation.** Any stop sets the keeper to "waiting for you" with a
  structured choice, as the workflow limit barrier does: **Extend** (n more
  rounds, with optional guidance), **Accept** (record as-is, keeper goes quiet
  until the next commit), **Off for this task**. Free text is guidance, never a
  command (ADR 0001).
- **Cost** is attributed per keeper on the task, as the advisor's
  (running-cost delta of the checker session). Fix turns are the task's own
  cost.
- **Surface.** The state shows in the keepers section, as a keeper type in
  #146's indicators on the rail tab and the sidebar row, and as a reason in
  the existing attention queue, beside PR feedback
  (`lib/attentionRail.ts:135-138`). No new sidebar filter, no
  settle/snooze/wake lifecycle.

### UI

**Keepers is a surface tab**, last in `DEFAULT_SURFACE_TABS`, so existing shortcuts keep their keys, hidden for
chats and Factory parents, carrying #146's activity badge. It lists the
project's keepers with their per-task switch, state, strip, findings (each
with Dismiss and a link to `file:line`), drafts, and the waiting choice.
*Rejected:* inside `ChangesRail` — that is the commit/shelf/stash panel of
the Diff surface. *Rejected:* banners in the chat — the conversation is the
agent's, and a strip per keeper does not fit there.

**The same status, compressed, on the PR glyph and the tile.** The sidebar's
`TaskPullRequestGlyph` and the header's `TaskPullRequestChip` get a keeper
dot (worst state wins); Mission Control's tile gains the PR glyph with it.
The meta lane keeps its width.

**Findings on an older commit are labelled, and a ready keeper's are
advice.** `TaskKeepers.head` carries the HEAD the poll last read. A card
whose latest counted run is on another commit names it and mutes its
status; for a `when: ready` run it points at Check before PR and adds no
dot, sidebar mark or push warning. The commit count is not shown: the
daemon reads only HEAD, not the log between.

## Invariants

1. **A checker never writes and never records a worktree.** All four of the
   advisor's enforcements apply on every start, resume included
   (`actor/keepers/`, ADR 0022 invariants 1 and 4).
2. **One writer per worktree.** Only the task's own session applies keeper
   findings. No path spawns a writing session for a keeper.
3. **No fix prompt into a busy or dirty task.** Mid-turn, a queued `User`
   prompt, or a tracked change in `git status --porcelain` defers it. The
   owner's Send to agent alone goes into a dirty tree, and its prompt says
   the changes are not the agent's; never when a finding's file is dirty.
4. **A result belongs to the HEAD it was computed on.** A run whose HEAD moved
   is `superseded` and its findings are never sent to a fixer. Only the
   owner's **Send to agent** sends findings from an older HEAD, and its prompt
   names that commit.
5. **Rounds count once.** A round increments when its fix prompt is handed
   over; an interrupted fix turn, a quota refusal and a restart re-entering the
   same round do not count (ADR 0001 invariant 8, ADR 0019 invariant 3).
6. **One reaction per fact.** The watermark row is written in the mirror
   before the reaction is dispatched; a reaction that fails to dispatch removes
   it. Keys are ADR 0020's.
7. **No GitHub-supplied text outside `<github_untrusted>`, and none in a
   command** (ADR 0020 invariant 8). Rerun ids are digits; refs are shell-safe.
8. **Never `--no-verify`, never a bare `--force`.** The daemon pushes with
   plain `git push`, except after a rebase, which uses `--force-with-lease`
   pinned to the head GitHub last reported.
9. **A CI fix that edits a test does not leave the machine without the
   owner.**
10. **Act only when GitHub's head equals local HEAD**, and only under a login
    equal to the PR's author.
11. **Nothing runs on a merged or closed PR**, and nothing re-arms it.
12. **No `git` or `gh` on the actor loop** (ADR 0002); polls, reruns and pushes
    are spawned. Test daemons run neither (ADR 0020 invariant 4).
13. **Every persisted keeper field carries `serde(default)`** (ADR 0001
    invariant 10).
14. **Keeper commands are one exhaustive `KeeperCommand` match**, never new
    arms on the chained `Command` dispatcher (CLAUDE.md, *Module layout*).
15. **Deleting a task deletes its checkers, runs, findings and reactions**
    (ADR 0022 invariant 5; ADR 0007 invariant 4 for writes landing after the
    delete).
16. **Code identifiers say `keepers` / `KeeperRun` / `keeper_*` in their own
    modules**; nothing named `keeper` goes into `src/daemon/memory/`, where
    the word means the memory a compaction keeps.
17. **Unattended fixes come only from collaborators.** A change request by a
    bot, or by an author without `OWNER`, `MEMBER` or `COLLABORATOR`
    association, is a draft, never a fix.
18. **A preset no project file names never runs.** Nothing spends tokens on a
    commit until the owner adds a keeper.
19. **A task without keepers behaves exactly as before.** Workflows, Factory
    tasks, the advisor and ADR 0020's manual **Send** keep their current
    paths; sandboxing and the daemon watermark apply only to tasks with a
    keeper on.
20. **A folder task's keepers check only its own branch, and a commit is
    attributed to the session that made it.** HEAD is read before the branch,
    so a switch between the two reads pauses the task instead of checking
    another branch's HEAD under its name. At the poll a new HEAD with exactly
    one folder task mid-turn is claimed by that task, the committer, and its
    turn holds the check until it ends; several mid-turn tasks leave the
    author ambiguous, so nothing checks until at most one is running. A fix
    into the shared checkout waits while another folder session of the
    project is mid-turn.

## Consequences

- Each commit on a task with three keepers costs three checker turns and, when
  red, one fix turn. With `max_rounds: 3` that is at most twelve checker turns
  and three fix turns per green. Precision and the strip are how the owner
  sees whether a keeper earns that.
- Keepers react only to committed work. An agent that never commits gets no
  keeper, which is by design: the commit is the "ready" signal.
- Work on the base branch gets no keepers (*Product shape*). Two folder
  sessions taking turns on one branch hand it back and forth: the keepers
  follow whichever turn ended last.
- Verify is `inconclusive` in a worktree until per-worktree services exist
  (#93, ADR 0024).
- With post-PR keepers, the owner's GitHub account pushes and replies while
  they are away from the keyboard. Teammates see the owner's name.

## Phases

**Phase 0 — prerequisites.** #146 activity indicators (keepers only add a
type). `PullWatch` reads `mergeable`, `mergeStateStatus`, `baseRefName`.
Docs: none (no user-visible change beyond #146's own docs).

**Phase 1 — v1: commit keepers.** Schema, presets embedded, **Add keeper**;
HEAD poll and debounce; checker child; one merged fix turn with
`TurnInitiator::Keeper`; mirror and tables; Keepers surface with strip,
findings, Dismiss, precision, the waiting choice; quota gate and stop rules.
Presets: **Review, Slop, Conventions** — diff-only, cheap, every commit,
finding counts, no runtime. The 20 s poll, the 60 s settle, the cap of four
checkers and the default test globs are first guesses; Phase 1 measures
them. Docs: new `guides/keepers.mdx` (what a keeper is,
adding a preset, reading the strip, dismissing, the waiting choice), new
`reference/keeper-files.mdx` (schema), a paragraph in `guides/working-in-a-task.mdx`
and `concepts/why-warpforge.mdx`.

**Phase 2 — ready keepers and Smiths.** `when: ready`, "Check before PR", the
Create PR dialog integration. Presets: **Intent, Security, Thermonuclear,
PR-ready**, and **Verify** (inconclusive in worktrees until #93). Smith
binding and the journal of dismissals. Mission Control tile glyph. Docs:
`guides/keepers.mdx` gains "Before the pull request" and "Keepers from a
Smith"; `guides/smiths.mdx` links to it; `guides/git-in-warpforge.mdx`
mentions the Create PR dialog's keeper section.

**Phase 3 — post-PR.** Waits for the four layers above: a shell-less
checker, structured fix requests, sandboxed task agents, and #120. Daemon watermark and the desktop
migration off `wf-pr-feedback`; poll at spawn; Rust feedback formatting;
**CI** (rerun once, base-failure check, conflict merge, daemon push, test-edit
gate) and **Team comments** (fix + "Fixed in", drafts); Factory tasks through
ADR 0023's reopen. Amend ADR 0020; mark ADR 0023 Phase 3 replaced. Docs:
`guides/pull-requests.mdx` "When CI fails or a reviewer asks" (what happens
on its own, what waits for you, the laptop-closed rule, which account posts);
`guides/factory.mdx` cross-link.

**Phase 4 — editing keepers in the UI.** #147 builds the form for workflows
and can land at any time; keepers join it once Phase 1 has fixed their schema
(name, description, harness, model, effort, time limit, instructions, result,
when, paths). The form writes the YAML and offers a raw view. Docs: `guides/keepers.mdx` "Create
a keeper" moves from hand-editing to the form; the reference page stays.

## Open questions

- **Phase 3 behind its four layers.** Recommendation: keep the dependency;
  if the wait is long, ship CI's rerun-once and conflict detection as
  display-only first.
- **Sandbox per harness.** Claude Code and Codex have OS sandboxes; opencode,
  pi and grok need checking. Recommendation: post-PR keepers refuse to run on
  a harness without one.
- **Reply marker defaults.** The trailing line (`— sent by Warpforge on
  behalf of <login>`) is a project setting, `keepers.sign_replies`. Open: its
  default; recommendation on.

Out of scope: closing a task's backlog item when its PR merges (the ADR 0023
gap) is a separate change on `PullWatch`'s merged transition, #148.

## Appendix — draft preset prompts

Each prompt is rendered with `{{task_title}}`, `{{task_brief}}` (the task's
opening prompt), `{{diff}}` (merge-base..HEAD, capped at 200 KiB),
`{{commits}}`, `{{dismissed}}` (findings the owner rejected), and `{{rules}}`
(CLAUDE.md / AGENTS.md and the ADRs' *Invariants* sections, for Conventions).
The daemon appends the result protocol for the keeper's `result`. Shared
preamble:

> You are {{name}}, one of this task's keepers. You only read: do not edit files,
> commit, or push. Report only problems you verified in the code. Defending an
> earlier finding is not a goal; if the change fixed it, say so. Do not raise
> anything in {{dismissed}} again.

1. **Review** (`commit`, `findings`). Find bugs, regressions and unhandled edge
   cases introduced by this change. For each: the input or state that breaks,
   what happens, `file:line`. No style, naming or speculative concerns. A
   finding without a concrete failure scenario is not a finding.
2. **Security** (`ready`, `pass_fail`). Report only vulnerabilities with a
   plausible exploit path through the changed code: who controls the input,
   how it reaches the sink, what they gain. Ignore hardening advice, missing
   defence in depth, and issues that exist unchanged on the base branch.
3. **Slop** (`commit`, `findings`, `min_severity: low`). Find code that reads
   as generated rather than written for this file: comments restating the
   line, defensive checks and try/catch on trusted paths, `any` or casts to
   silence types, needless nesting, helpers that wrap one call, patterns alien
   to the surrounding file. Each finding must be fixable without changing
   behaviour; say the mechanical fix.
4. **Thermonuclear** (`ready`, `findings`). Judge maintainability. Look for
   moves that delete complexity rather than relocate it: duplicated helpers,
   thin wrappers, ad-hoc branching that a data shape would remove, files over
   the project's size cap. Report at most five findings, each with the
   simpler shape. Silence beats a weak finding.
5. **Intent** (`ready`, `pass_fail`). Compare the change with the task brief.
   List what was asked and not done, and what was done and not asked. Quote
   the brief for each. Do not judge code quality.
6. **Verify** (`ready`, `verdict`). Turn the task's claim into a falsifiable
   check. Run it against the base and the change in the running app or browser
   when available. Report pass, fail or blocked with evidence, and whether a
   committed test now guards the behaviour; if none does, a finding asks for
   one.
7. **Conventions** (`commit`, `findings`). Check the change against the
   project's written rules in {{rules}}: file size cap, module layout, comment
   policy, required changeset and docs. Cite the rule for every finding.
8. **PR-ready** (`ready`, `draft`). Write a pull request description: a
   TL;DR that matches the diff, then what changed and why, grouped so
   mechanical changes stand apart from logic. If the change is too big to
   review in one sitting, propose a split as a list of PRs. Output only the
   description.
9. **CI** (`ci`, `findings`). For each failing check, find the cause using the
   given log command. One finding per cause, not per failing job. Say whether
   the failure looks flaky (timing, network, order) and why. Never propose
   editing a test to make it pass unless the test is wrong; say why it is.
10. **Team comments** (`comments`, `draft` per thread). For each thread,
    classify: `change_request` only when it is one clear instruction and no
    other reviewer disagrees; else `question`, `discussion` or
    `disagreement`. For a change request, state the change. For the rest,
    draft a short reply in the owner's voice that answers or asks what is
    needed to decide; never concede or refuse on the owner's behalf.
