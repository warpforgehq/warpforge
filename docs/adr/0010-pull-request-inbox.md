# 0010 — Pull-request inbox: a second surface, not a backlog column

**Status:** accepted (2026-09-07)

## Context

The backlog (ADR-0002) imports tracker issues into one normalized `WorkItem`
board. Pull requests arrive from the same trackers, and the obvious move is to
fold them into that board: one list, one shape. But a PR is not work to be
scheduled — it is a conversation with a diff attached. Its detail view needs
review threads, a raw patch, and "send to agent", none of which the backlog's
row/drawer model wants to grow into. Monocode's inbox (the reference
implementation) made the same split.

## Decisions

**The inbox is its own surface, provider-native.** The backlog stays a
normalized board; the inbox renders GitHub's own shapes (`PullRequestSummary`,
`PullComment`) directly, and an Overview/Diff split is a thing no backlog row
should carry. One pane (`InboxPane`) serves both contexts — the cross-project
Inbox view and a project's Pull Requests tab — pointed at a different
`projects` set, so the two cannot drift.

**Two tabs, and the conversation is not one of them.** The review first
shipped as Summary / Code / Conversation. Three tabs for two questions: what
is this change, and what does the code look like. Worse, the split cut the
review in half — the bot's summary sat in Conversation while the lines it was
about sat in Code, and neither tab could show you both. So:

- **Overview** is the pull request as a document: the description, then
  Activity — every review body and conversation comment as a card, in the
  order they arrived (`PullActivity`) — with a meta rail beside it
  (`PullMetaRail`: status, reviewers, checks, branch, and the changed files).
- **Diff** is the code, with the inline threads on the lines they were
  written about, which is the only place they read as review.
- A review card says how many inline comments its author left and takes you
  to the Diff tab rather than reproducing them (`onOpenDiff`). The count is
  per author, hung off that author's latest review, because the wire shape
  does not tie an inline comment to the review it was submitted with.

Nothing has a Conversation tab to hide in any more, so a thread GitHub has
outdated — `line` dropped, `originalLine` kept — renders in Activity with the
hunk it was written against. That is the whole of invariant 11's escape
hatch now: `isActivityItem` keeps exactly the nodes no diff row can carry.

**A commit range is two hashes, not a list of them.** Reviewing 40 files that
arrived in three commits is three reviews, so the Diff toolbar's commit picker
narrows the patch — and it narrows it the only way GitHub can answer: there is
no "diff of these commits" endpoint, only a comparison between two points. So
`tracker.pulls.commits` ships each commit's first parent (`parent_oid`), and
`tracker.pulls.diff` takes `from_oid`/`to_oid` — the first selected commit's
parent to the last selected commit — served by
`/repos/:o/:r/compare/:from...:to` (JSON for the file stats, the same URL as
`vnd.github.diff` for the patch). Selection is therefore a contiguous run, and
`lib/pullCommits` enforces that: clicking outside the span grows it, clicking
an end shrinks it, clicking an interior commit narrows to it. Offering
non-adjacent commits would mean rendering a patch nobody asked for and calling
it their selection.

Two consequences worth stating. The range is part of the diff's query key, so
switching commits is a cache swap rather than a refetch, and "all commits" is
free. And the overview keeps its own unranged fetch (they share a key when no
range is set, so it is one request): "13 files changed" describes the pull
request, and must not become 4 because someone is reading one commit. Viewed
marks do move with the range — a mark carries the fingerprint of the hunks it
was made against (below), and a commit's version of a file is not the pull
request's version, so a file ticked off in one view reads unviewed in the
other. That is the fingerprint rule working, not an accident.

**The changed files group by kind on the overview, by folder on the diff.**
`lib/pullFileGroups` splits paths into Implementation and Documentation
(prose extensions, `docs/`, `dataset/`, `.jsonl`) and sums each group.
Implementation opens, documentation folds: triage first, navigation second.
The Diff tab keeps its folder tree (`PullFilesRail`) because that is where
you navigate. Path heuristics, not GitHub metadata — the wire carries a path
and two counts, and asking the daemon to classify would put a UI opinion in
the protocol. Unrecognized paths fall to Implementation: a file misfiled as
prose is a file the reviewer skips.

**The overview's file list rides the patch fetch, but only for a change that
can afford it.** There is no files-only read on the wire, so the group list
comes out of `pulls.diff`. Fetching a capped 2 MB patch for every row someone
walks past with `j`/`k` is exactly what invariant 2 exists to prevent, so the
fetch is automatic under `AUTO_FILE_LIST_CHANGES` (3000 changed lines, from
the listing's own counts) and a button above it. A files-only daemon read
retires the heuristic.

**The header carries three rows and no verbs.** Status and identity, the
title, then author + branch route + diff size. The verdict actions moved to
the tab bar as quiet ghost buttons: approving is something you do once, at
the end, and it had been sitting in the reading path shouting through the
whole review. The rail owns everything countable — reviewers, labels,
assignees — which is what let the header stop wrapping.

**Seen state is localStorage, not the daemon.** Which rows the user has
looked at is per-device, worthless to sync, and must survive daemon restarts
without a schema. `lib/inboxSeen` keys on `repo#number` + `updatedAt`; a PR is
unseen when that timestamp moved. The first listing seeds silently, or a fresh
install lights the badge for work that predates the feature.

**The badge and the rows share one query.** `useInboxPulls` (30 s poll,
paused when the window hides) is the only fetch; the sidebar badge, the tab
count and both lists read its cache. A badge that disagrees with the list it
belongs to is a bug, and two pollers is how you get one.

**The review is a pane, not a drawer.** The detail first shipped as an overlay
docked over the right edge, capped at 42rem, inside a `max-w-5xl` card. That is
the wrong shape for the only thing this surface exists to do: read a diff. The
inbox is now a list rail (~320px) beside a review pane that takes every
remaining pixel, in both hosts. Both rails collapse — the window's own minimum
is 900px, and at that width a list rail, a file rail and a legible diff do not
fit together — through the same persisted toggle idiom the rest of the app uses
(`inboxListCollapsed`, `pullFilesPanelCollapsed`). The collapsed default is read
from the window width once, at store creation; a layout that re-collapses on
every resize fights the person dragging the window.

**Unified and split render from the same patch.** The split view pairs the lines
already parsed out of the unified diff (`lib/pullDiff.pairHunkLines`) — deletions
zip against the additions that follow them. It is a reshuffle, not a second
fetch: CodeMirror's `MergeView` would need both revisions of every file as
documents, which is exactly what invariant 4's size cap exists to avoid. The
switch shares the task diff's `diffView` setting, because "how I read diffs" is
one preference, not two. Syntax colouring parses each side of a file once with
the file's CodeMirror grammar and hands tokens back per patch line
(`lib/pullDiffHighlight`); it is decoration, so a missing grammar, a timeout or
a file past the budget renders plain rather than not at all.

**Viewed marks are the reviewer's bookkeeping, not the PR's state — but they
expire with the file.** Ticking a file off is per-device localStorage
(`lib/pullViewed`), and a new comment or a review does not clear it —
deliberately unlike `lib/inboxSeen`, which tracks whether the PR moved since
you last looked. But a mark is also scoped to the version of the file it was
made against: each entry carries `fingerprintPatchFile`'s hash of that file's
hunks (`lib/pullViewed`), and a mark whose fingerprint no longer matches the
file's current patch reads as unviewed. Without that, a mark from before a
push silently applied to a file that had since changed underneath it — the
same file path, materially different content, reported as already read.
Marks only ever expire this way; nothing re-validates or re-writes a stale
entry, it just stops counting until ticked again. `-v2` in the storage key
retired the pre-fingerprint shape outright rather than migrating it, since a
plain path list carries no fingerprint to check against.

**Files open, and folding is the reviewer's move — derived from viewed, not
snapshotted from it.** A file is folded exactly when it is currently viewed,
computed fresh on every render (`foldOverride.get(path) ?? !viewed.has(path)`
in `PullDiffView`), and open otherwise — so a file that arrives with a refetch
is open, and a mark that just expired reopens its file rather than leaving it
folded on a lie. Seeding a `collapsed` set once at mount from the marks was
tried and rejected: it froze the fold state to whatever the marks looked like
at that instant, which is exactly the staleness the fingerprint fix above
addresses in the marks themselves — deriving it once just moved the same bug
one layer up. Ticking "Viewed" folds a file because that derived default
flips the moment the mark is written; unticking unfolds it the same way. The
reviewer can still fold or unfold any file by hand independently of its
viewed state (`foldOverride`) — that choice holds until toggled again or the
pane remounts, but never suppresses the derived default for a file whose
viewed state next changes. The viewed control is a checkbox: a plain button
labelled "Viewed" reads as a claim that you already have.

**A comment can be written on a line, not just on the conversation.** Creating a
review thread needs GitHub's `addPullRequestReviewThread` mutation, which needs
the PR's own node id — resolved on the write path rather than threaded through
the read types, so a listing does not carry an id only a mutation wants.
Replies still ride `addPullRequestReviewThreadReply` with the thread's node id.

**PR reads reuse the `github/` module's dual path.** PAT + reqwest is the
primary path (no process spawn); the deprecated `gh` CLI answers when no token
is stored. Both land in the same wire types (`warpforge_protocol::pulls`), so
callers never learn which one ran. The thread is one GraphQL query for
comments + reviews + review threads (ADR heritage: the backlog's invariant 3,
one round trip per listing).

## Invariants

1. **No PR network call may run inside the actor** — same rule as ADR-0002
   invariant 1. The `tracker.pulls.*` dispatch arms run on the request task.
2. **One daemon fetch per (projects, state, assignedToMe).** Search narrows
   client-side; a keystroke must not cost a round trip, and the query key must
   not include what the fetch does not use.
3. **A comment body travels in a file** (`--body-file`) on the `gh` path, and
   as JSON on the PAT path — never inline in argv.
4. **The patch is capped at 2 MB** with a `truncated` flag. Rendering half a
   hunk is the client's problem to label, not the daemon's to hide.
5. **A thread reply is addressed to the review thread's GraphQL node id**, and
   only an id whose shape looks like a node id is accepted. A reply to a
   plain issue comment must not be attempted through the review-thread
   mutation.
6. **Avatars are initials.** The WebView's CSP allows only local media
   (`img-src 'self' data: blob:`), so remote avatar URLs must not be placed in
   `<img>`; routing avatar bytes through the daemon is not worth it.
7. **The review pane is one component for both inbox contexts.** A second
   detail view for the project tab is a behaviour fork waiting to happen.
8. **A comment body never travels in argv.** The `gh` fallback writes the body
   through a temp file (`--field body=@file`), including for the GraphQL
   mutation, because `github_query` splices its variables into argv. Known gap:
   the older `post_review_reply` path still passes its body through
   `github_query`, so a reply body does land in argv on the `gh` path today.
9. **A range is selected by dragging the gutter**, the gesture GitHub taught
   everyone (shift-click does the same for a line reached by scrolling). The
   whole number column answers the drag, not just the button inside it — that
   button only exists while its own row is hovered, so a drag that depended on
   it would break the moment the pointer left the 16px column. The press is
   handled on pointer-down, and the button has no click handler: a click firing
   after the drag would collapse the span back to one line.
10. **Only one gutter of a diff row offers to comment** — the side the comment
   would be addressed to (`RIGHT` for a kept or added line, `LEFT` for a
   removed one). Both offering it asks GitHub to anchor a thread to a line
   number that side does not have, and a composer keyed on the line number
   alone opens twice when both sides happen to share it.
11. **Inline threads anchor to the post-image line.** The wire shape carries a
    path and a line but not the side it was written on, so a thread on a
    removed line is not guessed onto a diff row. A thread with no `line` at
    all (GitHub outdated it) renders in Overview's Activity instead — the
    only conversation node that surface takes from the diff.
12. **A rail section that has no data says so.** Checks render "Status checks
    aren't read yet", not a green tick, and merged and closed both read
    "Closed" because no `mergedAt` travels. A review surface that invents
    reassurance is worse than one that admits a gap.
13. **A control never unmounts the surface it is driving.** The Diff tab
    renders its toolbar, then its body — the patch's loading and error states
    live *inside* `PullDiffView`, not in the host that chooses between a
    spinner and the view. Hoisting them was the first shape, and picking a
    commit closed the picker mid-selection: the click changed the query key,
    the host had no data to pass, and the whole surface — toolbar included —
    was replaced by a spinner. `keepPreviousData` on the ranged diff query
    keeps the previous patch legible while the next one arrives; the body
    dims, nothing moves.
14. **Only a commit hash addresses a comparison.** `from_oid`/`to_oid` are
    spliced into a REST path, so `is_oid` accepts 7–40 hex characters and
    nothing else — a branch name, a `..`, a slash or a query string is
    rejected before the URL is built. A range is also both hashes or
    neither: one alone is a bad request rather than a silent fall back to
    the whole pull request, which would show more than was asked for.

## Deferred (v2)

The daemon reads none of these yet, and the UI is built to say so rather than
to guess:

- **Check runs.** `statusCheckRollup` (state, name, url per run) would fill
  the rail's Checks section, which currently renders its own absence.
- **Merge state.** `mergeStateStatus` / `mergedAt` for "Behind main", a real
  Merged status, and a merge action.
- **More than 100 commits.** The picker reads `commits(last: 100)`: a longer
  branch loses its oldest commits from the list (never its newest), and
  nothing says so in the UI yet.
- **A files-only read** (`tracker.pulls.files`), so the overview's grouped
  file list stops riding the 2 MB patch fetch.
- **`reviewId` on inline comments**, so a review card can count its own code
  comments instead of counting its author's.
- **Linked issues** ("Resolves"), which needs the tracker link the wire does
  not carry.

Also deferred: Linear parity (the same pane takes a second provider later),
pending "draft" reviews (a verdict posts immediately), issue-only inbox items
(the backlog owns those), pushing a PR's comments into an existing task, and
the agent-authored review pass that the backlog tracks separately — Activity
and the Diff's thread cards are where its output will land.
