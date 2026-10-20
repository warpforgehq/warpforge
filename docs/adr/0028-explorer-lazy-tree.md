# 0028 — The Explorer reads directories on demand, and a watcher says what changed

**Status:** proposed (2026-10-20)

## Context

The Explorer tree is built from one `file.list` call that returns every file in
the checkout. On the largest registered project (kodjin-analytics) that call ran
`git ls-files --cached --others` without `--exclude-standard`: 712k lines,
66 MB, 4–8 s, followed by a stat per line, 25–32 s, before a name filter threw
99% of the rows away. The list the tree finally drew was ~7.5k files. The same
listing with `--exclude-standard` is 3.1k lines in 46 ms.

The cost is paid again on every refetch, and the desktop refetches the whole
list on `task.updated`, on every `file_edit` update in a conversation, after
commit, refresh and every branch or worktree operation (`gitMenu.invalidateAll`),
on the Explorer's refresh button, and on window focus once the 5 s `staleTime`
has passed. Five other surfaces (`@` mentions, Quick Open, Focus pane, New Task,
Smith chat) fetch the same RPC with `include_ignored=false`.

A quick fix (filter before stat, tree on `include_ignored=false`, a loading
skeleton) removes the 30 s case. It does not change the shape: one whole-repo
listing per refetch, and "changed" computed by a full `working_diff` each time.

Zed's worktree, read in its source, is the reference design: a filesystem walk
with `ignore`'s gitignore matcher; ignored directories never read until
expanded; a native watcher whose batched events reload only the changed paths;
git status from one `git status --porcelain` run, cached and joined to the tree
by path; a virtualised list of visible rows.

## Decisions

**Directories are listed on demand: `dir.list`.** The tree asks for one
directory's children when it is drawn expanded — the root on open, a folder on
expand. An entry is `{ name, kind: file|dir|symlink, ignored }`. The daemon
reads the directory with `read_dir`, classifies each child with the ignore
matcher, and never descends. `node_modules` costs one `read_dir` when someone
opens it and nothing otherwise. The daemon keeps no copy of a listing:
`read_dir` on a directory of a few hundred entries costs less than keeping
a cached copy correct.
*Rejected:* **keep `git ls-files` plus the reorder** — that is the quick fix; it
still lists and serialises the whole tree per refetch, still needs `working_diff`
for the change markers, and cannot show an ignored folder's contents without
returning to the 712k-line listing.
*Rejected:* **a streamed snapshot plus deltas** (Zed's `UpdateWorktree`) — it
needs entry ids, scan ids, chunking and a resync protocol on reconnect, and buys
little here: our directories are small, the webview never needs entries it is
not drawing, and invalidating one directory costs one `read_dir`. Deltas are
worth that machinery when the client must hold the whole tree; ours does not.
*Rejected:* **pushing the full tree once and patching it** — the same cost as
today at first paint, and memory in the webview proportional to the repo.

**Ignore classification is the `ignore` crate's matcher, not git.** A matcher
stack per root: nested `.gitignore`s along the path, `.git/info/exclude`, the
global `core.excludesFile`, then Warpforge's own rules (`HEAVY_DIRS`,
`IGNORED_NAMES`, task worktree paths). Matchers are built lazily per loaded
directory and dropped with it. A non-git project gets only Warpforge's rules.
*Rejected:* `git check-ignore` per listing — a subprocess on every expand.

**The watcher reports which directories changed, not what is in them.** One
watcher per watched root, created by `fs.watch { task_id | project }` and
released by `fs.unwatch` or by the connection closing. Raw events are batched
(trailing 100 ms, flushed at 1 s under a steady stream), mapped to parent
directories, filtered through the ignore matcher, and broadcast as
`fs.changed { root, dirs, index_changed }`. The desktop invalidates the
`dir.list` queries for those directories it holds; nothing else refetches.
`index_changed` is true when a non-ignored path was created, removed or renamed
(content edits do not change the mention list).

- **Lifecycle.** The registry is keyed by canonical root path, so a task
  without a worktree and its project share one watcher. Each connection's
  `fs.watch` adds a reference; disconnect drops all of that connection's
  references. At zero references the watcher lingers 30 s before teardown, so
  switching between tasks does not churn. At most 16 roots are watched; past
  that the oldest idle one is evicted. Archiving a task or removing its
  worktree tears its watcher down first.
- **macOS.** FSEvents, one recursive stream on the root. Events arrive for
  ignored paths too (an `npm install` floods `node_modules`); they are dropped
  by the matcher before they cost anything but the match.
- **Linux.** inotify is per directory, and `max_user_watches` is a
  per-user limit shared with every editor on the machine. Watches are
  non-recursive, added for each directory the client has listed and removed
  when its query is collected — never for unlisted ignored trees. On `ENOSPC`
  the root is marked `degraded`: the desktop falls back to refetching expanded
  directories on window focus and says live updates are off for that project.
- **Overflow.** The callback thread forwards events with `try_send` on a
  bounded channel. On overflow, or a kernel-reported rescan, the batch becomes
  "every listed directory changed", which the client handles like any other
  `fs.changed`.

**Git status is its own channel.** `git.status { task_id | project }` returns
`[{ path, code }]` from `git --no-optional-locks status --porcelain=v1
--untracked-files=all --no-renames -z` (0.12–0.24 s on the registered
projects), capped at 10,000 entries with a `truncated` flag. The tree joins it
by path and rolls a directory's marker up from its descendants client-side. The
daemon keeps the last result per watched root and pushes `git.statusChanged
{ root, entries, truncated }` when it differs. Refresh is coalesced per root:
at most one run in flight and one queued, whatever triggered it — a watcher
batch touching a non-ignored path, a change to the git dir's `HEAD`, `index`
or refs, or an explicit `git.status` call. A git operation in the app needs
no special case; it changes `index` or `HEAD` and the watcher sees it.
*Rejected:* **libgit2 or gix for status** — a large native dependency, a second
implementation of git's rules (sparse checkout, fsmonitor, `core.untrackedCache`,
attributes) that will disagree with the git the agents run, for a call the CLI
already answers in a quarter second. Zed made the same call.

**The mention list stays a flat list in the webview, fetched rarely.** `@`
mentions and Quick Open rank on every keystroke, and that ranking stays
client-side (`rankFiles`) over the existing `file.list` with
`include_ignored=false` — 46 ms on the largest project, ~300 KB of JSON.
For a watched root the daemon caches that list and rebuilds it only after an
`fs.changed` with `index_changed`; the desktop refetches it only then. Above
100,000 paths the reply is truncated and says so.
*Rejected:* server-side search per keystroke — a round trip per character for
a list that fits in memory many times over.

**Show Ignored Files is a client-side filter.** `dir.list` always returns
ignored children, marked. The toggle hides or shows them, greyed, with no
extra RPC; expanding an ignored folder is an ordinary `dir.list`. `.git` and
task worktree directories are never listed, whatever the toggle says.

**Bounded memory.** Daemon, per watched root: the set of listed directories,
their matchers, the last status (≤ 10,000 entries) and the mention list
(≤ 100,000 paths, ~10 MB worst case, ~300 KB on kodjin); at most 16 roots. A
single `dir.list` reply stops at 5,000 entries with `truncated`. Webview: one
React Query entry per listed directory, collected 5 min after it is collapsed
out of view; the tree renders only visible rows through the existing
virtualiser.

**It lives beside the actor, like `pull_status`.** A `daemon/explorer` module
hangs off `DaemonHandle`: `mod.rs` (registry and refcounts), `ignore.rs`,
`dir_list.rs`, `status.rs`, `watch.rs`, `batch.rs`. The actor is asked only to
resolve a task or project to its root path. `read_dir` and matching run on the
blocking pool behind a per-daemon semaphore of 8, so a burst of expands cannot
starve other blocking work; `git status` is an async subprocess; the watcher's
own thread only forwards. The old `file.list` path stays for compatibility and
for the mention list.

## Invariants

1. **No filesystem or git call on the actor loop** (ADR 0002). `daemon/explorer`
   never holds a `DaemonHandle` it could block on; watchers hold a weak sender,
   so a dropped daemon ends them.
2. **`git status` runs with `--no-optional-locks`.** Without it status refreshes
   the index, the watcher sees `index` change, and status runs again — forever.
3. **The watcher never walks or watches an ignored tree it was not asked to
   list.** (`explorer/watch.rs`) On Linux an `inotify` watch on `node_modules`
   is the difference between working and exhausting the user's watch limit.
4. **A project's watcher drops events under task worktree paths**
   (`is_worktree_path`). Worktrees live inside the project root; without the
   filter an agent's edits in its worktree invalidate the project's tree.
5. **Every `dir.list` path goes through `resolve_in_root`** (ADR 0017), and a
   symlinked directory is listed as a link, never followed out of the root.
6. **Refcounts are per connection and released on disconnect.** A client that
   crashes without `fs.unwatch` must not leave a watcher running forever.
7. **Coalescing never drops the last trigger.** A status refresh requested while
   one runs is queued, not discarded; otherwise the final state of a burst of
   edits is the one the tree never shows.
8. **Every reply path is total** (ADR 0002 invariant 4): a `dir.list` on a
   directory that vanished, a root torn down mid-request, or a semaphore closed
   at shutdown all answer with an error, not silence.

## Consequences

- The Explorer stops depending on `task.updated`, `file_edit`, git-operation
  and focus invalidation. Those triggers remain for `diff.get`, which this
  record does not change.
- A degraded watcher shows stale state until focus. That is today's behaviour,
  limited to the project that hit the limit, and the user is told.
- Two new dependencies: `ignore` and `notify`. Both are what ripgrep and most
  Rust editors use.
- The TUI does not use `file.list` and is unaffected.

## Out of scope, deliberately

Feeding the Changes rail from the status channel instead of `diff.get`; content
search (`file.search`) over the watcher's knowledge; watching for agents'
benefit. Each can build on this, and none is needed to fix the Explorer.
