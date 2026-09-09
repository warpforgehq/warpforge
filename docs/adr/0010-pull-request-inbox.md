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
Documentation leads and folds; implementation follows and opens. Order first:
under a 46-file implementation list the docs group was below the fold and
effectively invisible, and it is the group whose *heading alone* — count and
totals — is often the whole answer. Fold state second: the code is what the
review is for.
The Diff tab keeps its folder tree (`PullFilesRail`) because that is where
you navigate. Path heuristics, not GitHub metadata — the wire carries a path
and two counts, and asking the daemon to classify would put a UI opinion in
the protocol. Unrecognized paths fall to Implementation: a file misfiled as
prose is a file the reviewer skips.

**The overview's file list arrives on its own, on a delay.** There is no
files-only read on the wire, so the group list comes out of `pulls.diff` — and
fetching a capped 2 MB patch for every row someone walks past with `j`/`k` is
what invariant 2 exists to prevent. The first answer was a size threshold plus
a "Show file list" button, which turned the rail into two clicks: one to open
a group, one to see past the seventh file. Now the fetch simply waits
`FILE_LIST_DELAY_MS` (400 ms) after a pull request is selected — long enough
that walking the list costs nothing, short enough that nobody notices when
they stop. A files-only daemon read retires the delay too.

**The header carries two rows and no verbs.** Status, identity and author on
one line; the title on the next. The verdict actions moved to the tab bar as
quiet ghost buttons: approving is something you do once, at the end, and it
had been sitting in the reading path shouting through the whole review. The
branch route and the diff size left too — the rail states both, and a header
that repeats the rail is a header that reads twice. The rail owns everything
countable: reviewers, labels, assignees, branch, totals.

**Overview scrolls in three places, not one.** One scroller meant reading a
long description pushed the rail's status and file list off screen, and
scrolling a 52-file list dragged the conversation with it. So from 1280px up
the description+activity column and the rail scroll independently, and inside
the rail only the *file rows* move: the "52 files changed" line, the totals
and each group's heading stay put, because those are what you navigate by.
Below that width there is no room for a rail beside a readable measure, so it
stacks under the activity and the whole pane is one scroller again — which is
why every overflow rule there is `xl:`.

The file list also stopped truncating and stopped asking. It used to show
seven files per group behind an "N more files" button, on top of a "Show file
list" gate for large changes — three clicks to read a rail. It is one
scroller now, with each group's heading sticky inside it. One scroller and not
one per group: two open groups splitting the height meant opening the second
squashed the first.

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

**The diff pays per change, not per render.** A 10k-line pull request made
three things crawl, and each had its own cause.

*Menus.* `ui/dropdown-menu`'s `Content` is not portalled — the codebase
portals at the call site (`MessageActions`, `SidebarTaskRow`). The commit
picker, the send-to-agent menu and the Assistant's harness/model pickers did
not, so they mounted *inside* the patch's own scroll container: Radix's
positioning observers then measured a 10k-row subtree on open and on every
pointer move. They portal now.

*Row handlers.* Each gutter bound `onPointerEnter`, and each comment button
`onPointerDown`/`onPointerUp`/`onKeyDown` — ~50k closures rebuilt on every
render of a big file. The hunk container owns those four listeners now and
reads `data-line-id` off the event target, so a row is markup and nothing
else.

*Render scope.* Nothing was memoized and every `PullDiffFile` prop was an
inline closure or a fresh object, so ticking one file off re-rendered all of
them. `PullDiffFile`, `PullDiffLines`, `Gutter` and `LineText` are memoized;
the per-line `lineExtras` closure moved *into* the file (it builds its own
composers from a per-file thread map and a `draft` that is `undefined` for
every file the drag is not on). `PullDiffView.memo.test` pins both halves:
ticking a file off re-renders no other file's rows, and a unified/split flip
rebuilds exactly once per file. That flip is also a `useTransition` — the work
is unavoidable, blocking the click on it is not.

*Row count.* The three fixes above made the diff pay per change; they did not
make it cheaper to have 10k rows on the page at all, and on a real 60-file /
10k-line pull request it still sagged. Measured: `parseUnifiedPatch` costs 4 ms
(nothing), highlighting all 60 files costs 352 ms of synchronous main-thread
work, and one rendered row costs **11 DOM elements plain, 25–29 coloured** —
because colouring emits a `<span>` per token. That is a quarter of a million
nodes for one pull request. `content-visibility: auto` does not help: it skips
*painting* an off-screen subtree, not *creating* it.

So hunks mount only while they are near the viewport (`PullDiffHunk`), and
stand in as a spacer of their own height while they are not. Three details are
load-bearing. The height is **measured on the way out**, not estimated — a
spacer of the estimated height moves every row below it and takes the scroll
position with it. A hunk whose file carries a comment draft or a review thread
is `pinned` and never unmounts, because a composer's and a reply box's typed
text live in that DOM. And with no `IntersectionObserver` at all (jsdom, an old
webview) every hunk renders outright, so the diff is never blank because a
spacer never resolved.

Highlighting follows the same rule: a file colours only once it is near the
viewport, and `highlightPatchBlock` serialises its callers through one queue
with a yield between them, so two big files can no longer land 200 ms of
CodeMirror parsing on the frame that was trying to answer a hover. Adjacent
tokens sharing a class collapse into one span, which is worth ~7% of the rows'
elements — kept because it is free, not because it mattered.

Rejected: **row virtualization** (`react-window` and friends). A diff row's
height is not fixed — long lines wrap under `break-all` — the file headers are
`sticky`, and a windowed list breaks Ctrl+F over the whole patch. Hunk-level
mounting gives up Ctrl+F for off-screen hunks too, which is the one real cost
of this decision, and the same cost GitHub pays.

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

**An agent on the pull request is a third tab, backed by a real task.**
Reading a diff and asking about it are different postures, so the Assistant
sits beside Overview and Diff rather than inside either. Behind it is an
ordinary daemon task — same session, same transcript, same store — which is
what makes the conversation survive a restart without this pane persisting
anything of its own. What makes it *not* board work is one field: `origin =
"pr-review"` on `task.create` and on `TaskInfo`, which every board-shaped list
filters on (`lib/taskOrigin`: the sidebar tree, Mission Control's tiles and
attention queue, the backlog's live-task set, and the attention toasts).

Two buttons, one thread. "Explain" and "Review" differ only in the task they
open with (`lib/prAssistantPrompt`); pressing the second one sends a prompt
into the existing session rather than starting a second task, because
answering "what is wrong with this" without the walk-through that preceded it
throws away the context the user just paid for. Reopen-not-spawn is the rule
the pane resolves its task by: `origin` plus a `pr:{repo}#{number}` tag, never
a second row for the same pull request. The thread is openable as a task, just
not listed.

**A choice is grouped by what it does to you, not by what it runs.** The pane's
own buttons and the "Send to agent" menu both start agents, which is why the
first shape put five of them within an inch of each other — Approve, Request
changes, Send to agent, Explain, Review, Continue in task — and left the
reviewer to guess which one would take them off the pull request. Explain and
Review answer *here*, so they stay in the pane and say so in their tooltips.
Everything that becomes a task on the board lives under "Send to agent",
including opening the Assistant's own thread, and every item there states the
consequence in its second line ("Starts a task…", "Moves the Assistant's
conversation into its own task"). The trigger also stopped sharing `Sparkles`
with Explain: one icon on two doors reads as one door.

That item reads the task list itself (`AssistantThreadItem`) rather than the
pane hoisting the daemon snapshot into `PullRequestDetail`: menu content mounts
only when open, so a session update no longer re-renders the diff behind it.

The session runs without a worktree and without runtime context. A review
reads; a checkout per pull request would leave a worktree behind a surface
nobody can see to clean up, and the running-services preamble describes a dev
runtime that has nothing to do with the diff.

**"Send to agent" names the job; the Assistant answers questions.** The
button used to hand the New Task dialog four lines — number, title, URL,
branch route, under the words "Work on this GitHub pull request" — and nothing
about what to do with them. So the agent guessed, and its guess was usually a
summary of the diff: the very thing the Assistant tab now does in place,
without spawning board work. The overlap was the bug.

It is now two named actions (`lib/inboxTaskPrompt`), both for work that wants
a task of its own — a checkout, commits, a push, a row on the board:
*Address review comments* (disabled, with a reason, when nothing is
unresolved) carries the remarks themselves, with author and `path:line`,
because an agent in a checkout cannot see a review thread; *Work on this
branch* carries the description and the file list. Both open with
`git fetch origin <head> && git switch <head>`: a task that reasons about a
pull request from `main` is the most common way this goes wrong.

**The opening prompt names the files; it does not paste them.** The first
version packed up to 48 KB of patch into the Assistant's opening message and
told the agent to read the files for anything missing. Watching it run showed
the cost: the agent read the whole change twice — once as prompt text, once
with its own tools — and the prompt half was pure waste. So the diff is
inlined only under `INLINE_PATCH_MAX_BYTES` (8 KB), where a tool round trip
costs more than the text; above it the prompt carries the file list with
per-file counts and the two commands that produce the diff, and says to read
each thing once.

Those commands fetch and diff `origin` refs rather than switching branches:
the Assistant session runs in the developer's own working tree, so a
`git switch` there would move the tree under the person using it. The same
sentence sits in the daemon-side instruction, because that is what applies to
the follow-up turns.

**The shadow task's lifecycle is not the user's problem.** Nobody sees these
tasks, so nobody archives them, and the board's own sweeps deliberately skip
them (`origin IS NULL` in `find_ignored_waiting_tasks`,
`find_expired_closed_tasks`, `find_settled_tasks` — a shelf "delete finished"
must not take a PR conversation with it). Three rules replace the user:

- **Merged or closed → archived.** The inbox listing is the only thing
  watching GitHub, so this rides its poll (`usePrAssistantLifecycle`). A pull
  request that shows up closed is archived immediately; one that has dropped
  out of the listing is *asked about* (`pulls.details`, a few per poll, each
  once per session) rather than assumed dead — the default listing filter is
  `open`, so absence is the common case, not evidence.
- **14 days untouched → deleted**, through the ordinary `DeleteTask` path so
  the transcript goes with it.
- **50 conversations, newest first** — a reviewer opening twenty pull requests
  a day must not accumulate sessions without bound.

The last two are one store query (`find_stale_origin_tasks`) run off the actor
loop when a new PR Assistant task is created, and on the existing history
sweep.

**Style is daemon-side, shape is per-request.** The standing instruction
(`actor/pr_assistant::PR_ASSISTANT_SYSTEM`, adapted from Dex Horthy's
`/show-me` skill) started out listing every compact form the agent could
reach for. That leaked: pressing **Review** produced a four-section essay with
a diagram and pseudocode in it, because the system prompt kept asking for
forms the request had not. So the split is now strict — the system prompt
carries tone, grounding, read-once and "answer in the shape the request asks
for, and nothing else"; the request itself (`lib/prAssistantPrompt`) owns the
sections. Explain asks for three, caps its pseudocode at 12 simplified lines
and its diagram at 8 nodes; Review asks for findings, worst first, explicitly
without a diagram or a summary.

```mermaid fences render for real (`components/MermaidDiagram`, lazy-loaded,
theme-following). A diagram that will not parse falls back to its source *with
a line saying so* — the first version fell back silently, which is
indistinguishable from an app that cannot draw diagrams at all, and that is
exactly how it was first misread.

**The harness and the model are picks, not defaults.** The pane first used
the first configured agent with no control, so every conversation silently ran
on whichever harness happened to be first — and on whatever model that harness
defaulted to, which is unanswerable when one has five Anthropic models and the
next has an OpenRouter catalogue. Both are now pickers in the header, with the
harness's own logo (`components/AgentLogo`), remembered across sessions:
`prAssistantAgentId`, and `prAssistantModelByAgent` keyed per harness because
the lists have nothing in common. The model rides task creation as
`default_model`. Both collapse to labels once a task exists — the harness
behind a live session cannot change under it, and the model is switchable from
the transcript's own config bar from then on.

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
15. **A surface-owned task is never listed as board work.** `origin` is
    checked through `lib/taskOrigin`, not by comparing the string in place: a
    new board-shaped list is the failure mode here, and one helper is what
    makes "did you filter it?" answerable. The same field keeps those tasks
    out of the daemon's settle, retention and bulk-delete sweeps — they have
    their own TTL and cap instead.
16. **The two agent doors do different jobs.** The Assistant tab reads and
    explains, in place, on a hidden task. "Send to agent" hands out work with
    an instruction in it, as an ordinary board task. Neither should grow into
    the other: a "send to agent" that only summarises is the button this ADR
    already replaced once.
17. **The Assistant reopens; it never spawns twice.** One conversation per
    pull request, resolved by `origin` + the `pr:{repo}#{number}` tag. The tag
    alone is not the marker: a user is free to tag their own task `pr:…` and
    the pane must not adopt it.
18. **A prompt says where the code is; it does not carry all of it.** Above
    `INLINE_PATCH_MAX_BYTES` the agent gets the file list and the commands,
    not the patch — measured, after watching it read the same change twice.
19. **An off-screen hunk holds the height it measured, not the height it was
    estimated at.** `PullDiffHunk` reads the real height before it unmounts;
    substituting the estimate moves every row below the spacer and drags the
    scroll position with it. A hunk on a file with a draft or a thread is
    pinned and never unmounts — a composer's typed text lives in that DOM —
    and with no `IntersectionObserver` every hunk renders outright.
    And nothing the Assistant runs may switch branches: that tree belongs to
    the developer.

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
posting the Assistant's suggested comments straight onto the diff (it writes
them into the conversation; the reviewer still places them).
