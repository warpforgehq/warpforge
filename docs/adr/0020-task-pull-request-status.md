# 0020 — A worktree task's pull request is a daemon cache, pushed as it changes

**Status:** accepted (2026-09-28)

## Context

Opening a pull request from the push dialog ended with a toast and a browser
tab; afterwards nothing in the app said the task had one, whether its checks
passed, or that it had merged and the worktree could go. The sidebar row and
the task header are where that answer belongs, and both need it for many tasks
at once without costing a GitHub round trip per render.

## Decisions

**The state lives in `daemon/pull_status`, beside the actor, not in it.**
`PullWatch` hangs off `DaemonHandle`; it is a map from task id to the pull
request of that task's worktree branch. Fetches are spawned tasks running one
GraphQL `pullRequests(headRefName: <branch>)` query (including `headRefOid`)
against the worktree's `origin` repository, at most four at once — with the
backlog's credential and client (ADR-0002, 2026-11-21 amendment), not a `gh`
spawn. The lookup reads `origin` only, so a pull request from a fork against an
`upstream` repository is not found (known limitation). The actor is only asked
for the task list. *Rejected:* a field on
`TaskInfo` — the value is derived from GitHub, not owned by the task, and
routing it through the actor would persist and re-broadcast whole tasks for a
checks flip.

**Clients get it pushed.** `task.pullRequests` answers with the cache at once
and re-checks, in the background, whatever is older than `max_age_secs`;
changes go out as `task.pullRequest { task_id, pull_request | null }`. The
desktop calls it on connect and on window focus (120 s staleness) and when a
task is opened (15 s). `git.createPr` forces a re-check of its task.

**Polling is scoped to open pull requests.** The first refresh starts a
three-minute loop that re-checks only entries whose pull request is open or a
draft. A branch without one is looked at again only on focus or open; a merged
or closed one never changes on its own.

**A failed fetch keeps the last known state.** No GitHub credential, no
GitHub remote or offline all read as "nothing to show" for a task never seen,
and as "unchanged" for one that was. A badge that blinks off whenever the
network does is worse than one a few minutes old.

**Checks are one word.** Any failed check or error status is `failing`, then
anything not completed is `pending`, else `passing`; no checks is `None`.
`CANCELLED` counts as failing, as it does in GitHub's own rollup.

**A merged pull request offers the cleanup, the user confirms it.**
`task.archive` gained `remove_worktree`: the checkout and its local branch are
removed through the same path a merge-and-remove uses (`discard_worktree` in
`actor/commands/worktree.rs`). The work is on GitHub, so nothing merges
locally — a squash-merged branch would conflict with its own squash.

### Feedback goes back to the task (amended 2026-09-29)

After **Open pull request** the CI results and the review land on GitHub,
and the agent that made the change never hears about them. The entry now
carries what that agent would need, and the task offers to send it.

**Failing checks ride the listing; remarks are a second read.** The listing
already returns `statusCheckRollup`, so `failed_checks` (name, link, a
status's description) costs nothing. It cannot return review threads, so an
open pull request's conversation is one more GraphQL read — the inbox's own
query (`tracker::github_pr_conversation`) narrowed by
`pull_status/comments`: unresolved inline threads with their replies, and each
reviewer's latest verdict when it requests changes. Conversation comments are
left out; bots fill them with previews and coverage reports.

**That read is gated, not timed.** It runs inside a fetch this record already
schedules, only for an open or draft pull request, and only when `updatedAt`
moved since the last read or that read is older than 15 minutes (resolving a
thread need not move `updatedAt`). A failed read keeps the known remarks and
is retried on the next fetch.

**What the agent was told is per device.** The daemon reports the current
facts; the desktop keeps the keys already sent or dismissed per task
(`store/prFeedback`, localStorage) and raises the rest — a notice above the
task's conversation and an entry in Needs you. A check is keyed by head commit
and name, so the same failure after a new push is raised again; a thread by
its root and its latest comment not written by the pull request's author, so
a reviewer's reply re-raises it and the author's own "fixed" does not.
*Rejected:* a watermark in the daemon — a schema column for a fact only the
clicking surface produces, and the same trade ADR 0010 made for seen marks.

**Send is one `session.prompt` into the existing session.** `lib/prFeedback`
formats it in the diff-notes style: failing checks first, then remarks with
`path:line`, the quoted hunk lines, author and body. A busy agent queues it
(ADR 0011); it runs as a `User` turn because a person pressed the button.
Everything GitHub supplied — check names and summaries, links, the title,
authors, quoted hunks, comment bodies — goes inside a `<github_untrusted>`
block (`lib/untrustedBlock`, the scheme of `src/mcp/untrusted.rs`), because
anyone who can comment on a public repository writes it and it would
otherwise reach the agent as the owner's words. The instructions, and the
log commands built from a job id that must be digits in a `github.com`
Actions link, stay outside it. The inbox's task prompts (`lib/inboxTaskPrompt`)
and the PR Assistant's opening prompt (`lib/prAssistantPrompt`, ADR 0010)
wrap the same way, and name a branch in a command only when it is
shell-safe (`isShellSafeRef`).
**Dismiss** records the same keys without sending.

**Job logs are not fetched.** `gh run view --log-failed` downloads the run's
whole log — seconds and megabytes per failed check, on a three-minute poll,
for failures nobody may act on. The prompt carries the check's link and, for
an Actions job, the command that prints the last 80 lines of its failed steps;
the agent runs it once, in its checkout, when it acts. Same rule as ADR 0010's
prompts: say where it is, do not paste it.

**Nothing is sent on its own.** An "auto-send CI failures" toggle is deferred:
it would have to work with the window closed, which moves the watermark into
the daemon and the send onto a dispatch path that must respect ADR 0019's
quota gate.

## Invariants

1. **No GitHub call on the actor loop** (ADR 0002). `PullWatch` never holds a
   `DaemonHandle`; the poll loop keeps a weak command sender so a dropped
   daemon ends it.
2. **Removal is refused while the agent is mid-turn, the checkout is dirty,
   or HEAD holds commits nothing else keeps.** Removal is `git worktree remove
   --force` then `git branch -D`. `pull_status::removal_blocker` allows it only
   when the pull request's `headRefOid` contains HEAD (squash merges, pruned
   head branches) or no commit is reachable from HEAD alone — not from a
   remote, not from another local branch.
3. **A reply must not undo a newer event.** The desktop stamps every
   `task.pullRequest` and a `task.pullRequests` reply leaves stamped entries
   alone (`daemon/tasks.ts`).
4. **Test daemons never call GitHub.** `PullWatch::default()` fetches nothing
   under `cfg(test)`; tests inject a scripted fetcher and comments fetcher.
5. **The remarks read has no timer of its own.** It rides a scheduled fetch,
   is skipped for merged and closed pull requests, and while `updatedAt`
   stands still inside `COMMENTS_MAX_AGE`.
6. **A failed remarks read never clears remarks**, for the same reason a
   failed listing never clears a badge.
7. **Only a click sends feedback to an agent.** The notice and the Needs-you
   entry offer; nothing in the daemon or the desktop prompts on its own.
8. **No GitHub-supplied text outside the untrusted block**, and none in a
   command: a command carries only a validated number or a shell-safe ref.
   This holds for every prompt built from a pull request — task feedback,
   the inbox's task prompts and the PR Assistant's.
