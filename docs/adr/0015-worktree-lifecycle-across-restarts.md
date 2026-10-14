# 0015 — Worktree lifecycle survives a daemon restart

**Status:** accepted (2026-09-23)

## Context

A task's isolated checkout lives under `<project>/.worktrees/<task_id>` and is
tracked by an in-memory `WorktreeManager` per project. The manager was built
lazily on first use and never rebuilt, so a daemon restart left it empty while
the tasks in the store still recorded their worktree paths. Three failures
followed: deleting such a task skipped worktree removal and orphaned the
directory (with its build output), `task.mergeWorktree` failed with "no worktree
for task", and conversation branches lost the source branch they inherit from.

Separately, worktree creation and removal were awaited inline on the actor,
which stalls every task while a large checkout is written or a GB-sized build
dir is deleted (ADR 0002). And a failed `git worktree add` was only printed to
stderr, so the task silently ran in the project checkout with no isolation and
no signal.

## Decisions

**The manager is rebuilt at boot from the persisted tasks.** Each recorded path
is cross-checked against `git worktree list --porcelain`; only paths git still
reports as worktrees of the project are adopted. The `git worktree list` call
runs synchronously in `Daemon::spawn`, before the actor loop — startup already
reads the store directly, so this is not the hot path ADR 0002 protects.

**A task loses its `worktree` only when git confirms the checkout is gone.**
When git fails (not on the app's PATH, an unmounted project, a lock), adopt and
clear nothing — one transient failure must not move every isolated task to the
main checkout. A recorded path that is unlisted but still exists on disk is left
alone too; only a path git does not list and that is also absent from disk is
cleared and persisted, so the task runs in the project checkout, the path every
consumer already handles. Nothing is deleted from disk at boot.

**A restored `base_branch` is the root checkout's branch at boot**, not
necessarily the branch the worktree was forked from — the store does not record
the fork point. Merge checks out that branch, so a merge after a restart can
target the wrong base; nothing calls merge today.

**Removal runs off the actor.** Delete resolves the git/fs inputs, drops the
manager entry immediately, and spawns the removal. Terminals are killed and the
session cancelled before removal starts, as before. The workflow merge path
already ran detached; creation now does too — the first workflow stage starts
from the `WorktreeReady` handler instead of inline.

**A failed checkout blocks the task and is surfaced.** The task's
`blocked_reason` carries the git error and its status becomes `Blocked`, which
the existing attention rail renders; sending a message then retries it in the
project checkout, prepending the task's original prompt (and its attachments,
model and overrides, held in memory until the retry). A workflow parent is
finalized with `WorkflowOutcome::Error`, which does the same. It must not fall
back to an unisolated run without telling the user.

## Amendment — Merge-back (2026-09-23)

The task records the branch its worktree forked from (`base_branch`, persisted
at creation), so a merge after a restart targets the real base rather than the
root checkout's branch at boot. Boot restore prefers the persisted value and
keeps the old guess only as a fallback for tasks created before it existed.

`merge_detached` never runs `git checkout`. It refuses when the task worktree is
dirty (untracked files included — they would be left out of the merge) or the
branch has no commits beyond base, and while the task has a turn in progress.
When the base is checked out in the root or another worktree it requires that
checkout to be clean of tracked changes (`--untracked-files=no`; git itself
refuses if an untracked file would be overwritten) and merges there; otherwise
it fast-forwards with `git update-ref`, or writes a merge commit with
`git merge-tree --write-tree` + `git commit-tree` + `git update-ref` when the
lines diverged. `git merge-tree --write-tree` needs git 2.38+; older git gets a
clear error for that path only. The client chooses whether a successful merge
also removes the worktree (default yes). When removed, the task's terminals are
killed and its live session cancelled and dropped before the checkout goes away,
then the task is marked `Done` — the merged work is finished. When kept, the
session and status are left alone and the task keeps its `worktree` and
`base_branch`.

## Amendment — Worktree location (2026-09-23)

New task worktrees live at `<project>/.warpforge/worktrees/<task_id>`, not at a
root-level `.worktrees/`. `.warpforge/` is committed project config
(`workspace.yaml`, workflows), so keeping the checkouts there means they are
cleaned up with the project and inherit its agent trust, and they no longer
collide with a project that happens to use `.worktrees/` for something else.
The location is named once (`worktree::worktree_path` / `WORKTREES_REL`).

Creation writes `<project>/.warpforge/worktrees/.gitignore` with `*` and a
`# Created by Warpforge automatically.` comment, idempotently and best-effort
(failure is logged, never blocks the checkout). This is a `.gitignore` inside
the worktrees folder — not the user's root `.gitignore`, and not `.git` — which
is the one exception to invariant 6. Legacy tasks keep their recorded
`.worktrees/<task_id>` paths exactly as they are: nothing is migrated or moved,
and the `info/exclude` line is added only when a `.worktrees/` directory
actually exists.

The file tree and `git.roots` skip both locations, matched as a path
(`.warpforge/worktrees` or `.worktrees`), never by the bare name `worktrees`:
`HEAVY_DIRS` matches names at any depth, so a bare entry would hide an
unrelated `worktrees/` folder.

## Amendment — Chosen base, existing branches and pull requests (2026-09-28)

`task.create` takes an optional `worktree_base`: a new task branch forked from
a named local branch, or from origin's default branch (fetched first; the
default comes from `origin/HEAD`, else `git ls-remote --symref`), or an existing
branch checked out as-is — a local branch, a remote-tracking one (a local branch
tracking it is created), or a GitHub pull request's head looked up with
`gh pr view`. A fork's pull request gets a remote named after the fork owner
(reused when an existing remote already points at the fork, as `gh pr checkout`
does), so the branch tracks `<owner>/<head>` and a plain push updates the PR.
New Task lists pull requests through the existing `tracker.pulls.list`.

The base is resolved in the RPC handler, before the task exists, so an unusable
choice is an error the dialog shows rather than a blocked task: an unknown
branch, a merged pull request, or a branch already checked out in the project
checkout or another worktree (git allows one checkout per branch). Fetching and
`git worktree add` still run in the detached creation, and a failure there
blocks the task as before.

`base_branch` is the **merge target**, always a local branch name: the forked
branch, the default branch's local name for an origin base (never
`origin/main` — the merge moves `refs/heads/<base>`), the pull request's base
branch, or the root checkout's branch for a plain existing branch. Forks use
`--no-track`: from a remote-tracking start point git would otherwise make the
base the task branch's upstream, and a push would aim at it.

Only branches under `warpforge/task/` are deleted when a worktree is removed;
an existing branch the task checked out is the user's and survives the task.
Automations accept only the fork bases (branch, origin) — each run starts a new
task branch, so checking out one existing branch run after run cannot work.

## Invariants

1. **`daemon/worktree/` — the manager is a cache, not the source of truth.** The
   persisted `task.worktree` and `git worktree list` are. Anything that removes a
   checkout must leave both consistent (clear the field or delete the row, and
   let git drop the entry).
2. **A task with `worktree: None` always means the project checkout.** Do not
   add a third state (a path that may not exist); repair it at boot instead.
3. **Boot never deletes files, and never clears a record on a git failure.** A
   `git worktree list` that did not succeed is not evidence a checkout is gone.
4. **No git worktree work on the actor loop** (ADR 0002). Create, merge and
   remove are handed to a spawned task; the handler only edits its maps.
5. **A checkout failure is never silent.** It blocks the task or fails the
   pipeline with the git error attached.
6. **Worktrees are hidden without touching the user's `.gitignore` or `.git`.**
   New worktrees carry a `.gitignore` inside `.warpforge/worktrees/` (`*`);
   legacy `.worktrees/` checkouts are hidden via `info/exclude`, added only when
   that directory exists. The file tree and search skip both locations
   independently of either mechanism.
7. **A merge never changes the HEAD or the working files of a checkout that is
   not on the base branch.** It runs only in the checkout that has the base
   checked out, and only when that checkout is clean; every other merge is a ref
   update with no checkout.
8. **A conflict leaves every ref unchanged.** No partial merge commit, no moved
   branch, and the base checkout is aborted back to its pre-merge state.
9. **Removing a worktree deletes only a branch the daemon created**
   (`warpforge/task/*`, `worktree::owns_branch`). A checked-out existing or
   pull request branch is never deleted with its task.
10. **`base_branch` is a local branch name.** An origin base records the
    default branch's local name, not the remote-tracking ref.
11. **The branch picker never checks out a branch held by another worktree.**
    It opens the owning task, or names the worktree path; `git.switchBranch`
    refuses the same case. No force, no `--ignore-other-worktrees`, no
    auto-detach.
