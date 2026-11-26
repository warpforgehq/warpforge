# 0005 — The virtualiser owns the chat scroll, and the transcript arrives whole

> The desktop attention and dashboard presentation in this record was superseded by [0032](0032-permanent-rail.md#2026-11-27-update).

**Status:** accepted (2026-08-30); amended twice on 2026-09-23 (see the end)

Applies to `desktop/src/components/SessionChat.tsx`, `desktop/src/lib/chatScroll.ts`
and the `session_history` field of the daemon snapshot
(`crates/warpforge-protocol/src/event.rs`, `src/daemon/actor.rs`).

## Context

The task transcript is a `LegendList` (`@legendapp/list` 3.3.5, plus the
anchoring patch in `desktop/patches/`) over hundreds to thousands of rows. Only
the rows near the viewport are ever measured; everything else is sized from a
running per-type average. Two independent mechanisms can move the scroll:

- `maintainScrollAtEnd` — the list pins itself to the true end while the
  viewport is inside the follow zone.
- `maintainVisibleContentPosition` (MVCP) — the list picks an anchor row and
  compensates the scroll offset so that row stays put as content around it
  resizes.

Both compute in the same currency: estimated content size. Four separate
attempts to stop long chats jerking upward on every new message each fixed one
symptom and left the cause standing. The two causes turned out to be *both
mechanisms running at once*, and *the transcript arriving in two pieces*.

The second one came from the cold-start work: the connection snapshot carried
only a 200-row tail per task and the desktop fetched the rest per task after
open, prepending it above the viewport. Every prepended row was unmeasured, so
the list's total-size estimate lurched the moment they took real sizes, and the
offset the list was holding no longer pointed at the same message. Attempts to
paper over that — re-pinning across two frames after the backfill, then hiding
the list behind a placeholder until the backfill landed — traded one artefact
for another; the second also made every long chat open on a spinner.

## Decisions

**While following the live edge, `maintainScrollAtEnd` owns the scroll and MVCP
is off.** `transcriptRestoreMode` (chatScroll.ts) returns `"none"` in that
state, and `SessionChat` passes `undefined` for
`maintainVisibleContentPosition`. *Correction (2026-09-23):* `undefined` is not
off — LegendList normalises it to `{data: false, size: true}`, so the size half
of MVCP has been running in this state all along; see the amendment. Anchoring while following means MVCP's
compensating adjust races the end-pin over estimates that churn on every
streamed token, and the viewport walks upward by the drift. *Rejected:*
`{data: false, size: true}` while following — that was the pre-`65f87c7`
shape, and turning `data` off let per-type averages drift unchecked, which is
the same slide from the other direction. The lesson is not "which MVCP flags",
it is "not two owners".

**Anchoring is for reading and for disclosure settle.** Once the user scrolls
away from the end, `transcriptRestoreMode` returns `"reading"`: MVCP restores
only the topmost visible row (second amendment). Restoring every row (`"all"`)
was tried and blanked rows out as the list recycled them. While a work-group disclosure settles,
MVCP restores only the toggled row (`"anchor"`, keyed on
`work-toggle:${groupId}`) so the trigger stays under the cursor instead of the
viewport chasing the end, and `maintainScrollAtEnd` is suspended for the two
frames the settle takes.

**The follow-zone threshold stays generous (3 viewports,
`CHAT_MAINTAIN_SCROLL_AT_END_THRESHOLD`).** The list
derives distance-from-end from estimated content size, and estimate error over
unmeasured rows inflates it. A tight band (0.05 was tried) makes the list stop
pinning while the app still believes it is following — at which point nothing
stabilises the scroll at all.

**The transcript arrives in one piece.** A mounted transcript is only ever
appended to — but *when* it mounts is the lever cold start pulls. The
connection snapshot carries tasks and metadata only (zero transcripts), and a
chat fetches its own task's whole folded history via `session.history`
(`Command::SessionHistory`, `DaemonHandle::session_history`,
`Store::load_session_updates`), mounting the list only once that fetch has
resolved. Until it resolves — successfully or not — the chat shows a brief
placeholder, so nothing can appear above the viewport of a mounted list. An
earlier variant of this split the delivery: the snapshot carried a 200-row
tail, the chat rendered it immediately and backfilled the rest above the
viewport, and every prepended row was unmeasured (see Context). The mistake
was one truncated payload serving two purposes — the sidebar's summaries and
the chat's transcript — not lazy loading itself. Summaries now degrade instead:
live events refill `state.sessionUpdates` as they arrive, and
`TaskInfo.pending_permission` (computed daemon-side at snapshot time) keeps the
"needs you" badge honest without any transcript. The whole retention lifecycle
(transcript prune, auto-settle, task expiry, Settings UI, daily sweep) is what
bounds the database.

**Pinning goes through the scroller node, not `listRef.scrollToEnd()`.** The
imperative method resolves an absolute target from frozen size estimates, so in
a long transcript it lands where the estimate claimed the end was — possibly
outside the follow zone, where nothing re-pins.

## Invariants

1. **Never two scroll owners at once.** If `maintainScrollAtEnd` is active,
   `maintainVisibleContentPosition` must be `undefined`, and vice versa.
   (`undefined` still leaves size-only MVCP on — Invariant 13.) This
   is the whole content of `transcriptRestoreMode`; any new scroll behaviour
   goes through that function rather than beside it.
2. **Nothing is prepended above the viewport after the list mounts.** A task's
   rows may only be appended. A transcript therefore mounts *after* its full
   fetch resolves — a placeholder stands in until then. Any future cold-start
   optimisation must keep this; the alternative costs a scroll jump per
   prepend, which no amount of re-pinning hides.
3. **`{data: true, size: true}` whenever MVCP is on.** `size` stabilisation
   keeps the total content size from moving by the estimate drift times the
   unmeasured row count; `data` keeps it stable across each streaming delta.
   Turning either off has been tried and slides the view into old messages.
4. **`maintainScrollAtEndThreshold` is a wide band, not a pixel-tight one.**
   It is measured against estimated content length, not the DOM.
5. **The MVCP object is built in a `useMemo` in the component body**, not
   inline in JSX. A hook inside a prop expression is invisible to the rules of
   hooks the moment anything wraps that element in a condition.
6. **Only an upward gesture detaches following.** Scrolling down, clicking a
   file link, expanding a work group and selecting text are not navigation away
   from the latest message.
7. **`@legendapp/list` is patched.** `desktop/patches/@legendapp%2Flist@3.3.5.patch`
   bounds the anchored end-space by a known-size cap and propagates shrinks
   before the list is ready. Note that as of 3.3.5 the code it edits sits
   entirely inside `if (anchoredEndSpace)`, and nothing in `src/` passes that
   prop — so the patch is currently inert here. It still pins the version.
8. **Gesture handlers are React props on the list, never hand-attached to
   `getScrollableNode()`.** The imperative version asked for the node inside a
   single `requestAnimationFrame` and gave up silently when the list had not
   populated its ref yet — which is the common case on a cold mount. Traced
   across two full sessions: not one detach ever fired, `following` stayed true
   forever, and the chat pinned to the end no matter how hard the user scrolled
   away. Switching to another task and back "fixed" it only because that
   re-runs the effect against a ready ref.
9. **An upward gesture outranks the re-arm band.** Leaving the end crosses
   `CHAT_FOLLOW_REARM_PX` on the way out — traced at six consecutive events
   between -51 and 15 — so re-arming on distance alone undid the gesture in the
   same tick it happened. A wheel-up inside `GESTURE_WINDOW_MS` suppresses it.
10. **`drawDistance` is margin against wrong estimates, not against speed.**
   Unmeasured rows are sized by the average of their `getItemType`, and
   `agent_text` spans one-line replies to two-thousand-pixel answers, so its
   average badly overstates the short ones. At 250 the window only had to cover
   ~1000px, which a single overestimated row satisfied alone: traced rendering
   exactly one row (`start: 414, end: 414` of 494) into an 840px viewport, with
   the rest of the screen blank.
11. **Clipping a message with CSS does not make it cheap.** `CollapsibleMarkdown`
   hid overflow behind `max-h-44` while still parsing and highlighting the whole
   string. A pasted log of a few thousand lines paid its full render for 176px
   of output, synchronously — the main thread stalled long enough that text
   could not be selected and the composer refused input, always at the same
   scroll position. Collapsed messages render a bounded prefix instead.

## Debugging

Every fix in this record after the first four came from instrumenting the
scroll machine and reading the numbers; the ones before came from reading the
code, and each fixed a real contributing cause without curing the symptom.

The instrumentation is not kept in the tree — it is a dozen `traceScroll` calls
and a ring buffer, cheaper to rewrite than to maintain. What matters is what to
record, learned the hard way:

- the list's own render window from `getState()` — `start`, `end`,
  `startBuffered`, `endBuffered` against `data.length`. A window of one row
  against an 840px viewport is what "messages disappeared" actually was.
- whether the gesture listeners ever attached, and after how many frames, kept
  somewhere a buffer reset cannot clear. Its absence reads identically to a
  stale build, which cost two rounds.
- one entry per detach, deduplicated. A single wheel gesture emits dozens, and
  each lands twice — the list spreads unknown props onto two nested nodes.

Record from the first frame, not from when a console is opened: the interesting
events happen while the transcript mounts. And always cold-reload before
judging a fix — a warm app has its row measurements cached, produces no height
churn, and looks fixed when it is not.

## Consequences

- `mergeSessionHistory` exists to reconcile a task's fetched transcript with
  the live updates that arrived while the fetch was in flight — the live copy
  folds raw frames, the fetch returns a folded history, so they are not
  positional suffixes of each other.
- `DaemonClient.loadSessionHistory` always resolves, even when the daemon
  cannot answer; a chat then mounts on an empty transcript and refills from
  live events. A failed fetch is retried on the next open of the task.
- Connecting to a large database no longer reads the transcripts table at all:
  the snapshot is tasks and metadata only, and each chat pays for exactly one
  indexed per-task read.

## Amended 2026-09-23 — the end pin runs before paint

Two reports drove this: *approve while reading* (the transcript jumps up to
older messages after a permission is approved) and *bottom jitter* (the chat
twitches while following a streaming answer). Both were measured in WebKit
(Playwright) against the dev daemon with a mock agent, cold-reloaded before
every run, on a 1,900-update transcript and a fresh 6-turn one, three runs per
scenario, before and after the change.

**Bottom jitter — cause.** Two lags stacked on every streamed chunk:

- `maintainScrollAtEnd` calls `scrollToEnd` from inside a
  `requestAnimationFrame`, so it always lands at least one frame late.
- The list measures a grown row in its own `ResizeObserver` and commits the new
  content height from there. The `keepAtEnd` observer watches the content
  wrapper, which is shallower than the rows, so the browser defers its
  notification to the next frame (the "ResizeObserver loop completed with
  undelivered notifications" error in the console is that deferral).

The frame in between paints the view short of the end — by the 56px footer, or
by the whole chunk.

**Change.** `useTranscriptFollow` also pins from a `MutationObserver` on
`style` writes inside the content wrapper. The height commit is a style write;
the observer runs as a microtask right after it, before that frame paints. It
shares the `keepAtEnd` guard: only while following and not settling a
disclosure. MVCP, fold timing and the disclosure settle are unchanged.

| Painted frames while following (S3, 5 turns × 3 runs) | main | amended |
| --- | --- | --- |
| max distance from end, long transcript | 318–424px | 0px |
| max distance from end, fresh transcript | 56px | 0px |
| reversals caused by scroll lag | present every chunk | none |

**What still moves while following — content, not scrolling.** Every remaining
reversal was attributed frame by frame:

- *The activity line.* The "working" line under the transcript unmounts at turn
  end and mounts at turn start. The scroller changes height by 43px and, with
  the bottom pinned, the whole transcript shifts by 43px minus whatever the
  final chunk added. This is the "−43px at turn end" seen before — it was
  attributed to MVCP's scroll adjust, but the trace shows `clientHeight`
  changing by exactly 43 in that frame. Removing it is a layout decision (for
  example overlaying the line on the footer spacer), not a scroll fix.
- *Step gaps in a live group.* A group is live only while one of its calls is
  in progress, so between one step finishing and the next starting it folds,
  then reopens a frame or two later (32→29→125px in the mock). Keeping it open
  across the gap would change when groups fold, which is not a scroll fix.
- *The fold itself* (−134px) when a group settles — kept, by constraint.

**Approve while reading — not reproduced** *(corrected in the second
amendment: it needs a transcript at the session cap)*. Approving while reading 0.5, 1 and
3 viewports up, with short and long answers after the approval, through the
toast and the inline button, on five transcripts: the top visible row never
moved (Δ0px, 0 blank frames) on main or amended. The suspected mechanism does
not hold in 3.3.5: on data changes the list keeps the cached size of every
unmeasured row (`preferCachedSize` is forced on), so a new average cannot
re-lay out rows above the viewport, and the size half of MVCP is on while
reading (see below). A reading anchor was therefore not added. One harness
artefact looked like the bug: Playwright's `click()` scrolls an off-screen
button into view, which re-arms following.

**Owner constraints, from failed attempts.** No animation of any kind: groups
fold instantly. Finished groups keep folding while the reader follows the live
edge — holding them open to hide the shrink was rejected. Opening or closing a
group by hand must not move its header (measured 0px, main and amended).

### Invariants (continued)

12. **The end pin must land before the frame paints.** A `ResizeObserver` on
    the content wrapper is not enough — the list commits heights from inside
    its own observer and the wrapper's notification is deferred a frame. The
    `MutationObserver` on the height commit is what closes that frame. Do not
    move the pin into `requestAnimationFrame`: that is the lag
    `maintainScrollAtEnd` already has.
13. **`maintainVisibleContentPosition={undefined}` is not off.** LegendList
    3.3.5 normalises it to `{data: false, size: true}`: size-only MVCP runs
    while following, anchored on the first row in view. Pass `false` to switch
    it off. Measured harmless while following; do not change it without a
    trace that says otherwise. *Correction (second amendment):* while reading,
    MVCP is no longer left at this default — it explicitly sets
    `{data: true, size: true}` (see the fix below).
14. **Judge a scroll fix on painted frames only.** Samples taken in
    `requestAnimationFrame` or in a posted task include React commits that are
    not yet laid out or pinned, and overstate the distance by a whole chunk.
    Sample from a `ResizeObserver` created after the list's, on a sentinel
    whose size flips every frame — it fires last in the frame, right before
    paint.
15. **Fold timing follows `live` exactly.** A scroll fix must not delay, hold
    or animate a fold; the list absorbs the shrink.

## Amended 2026-09-23 (2) — keys survive the session cap

**Cause of "jumps while reading".** The desktop caps a transcript at
`MAX_SESSION_UPDATES` (2,000 coalesced updates) and drops from the front. Row
keys for updates without their own id are the array index (`i:${index}`), so
once a transcript sits at the cap every streamed update shifts every such key.
The list reads them as new rows, re-estimates their heights, its content length
lurches, and the reader lands far up. Only transcripts at the cap do this,
which is why the first amendment could not reproduce it on smaller ones.
Replaying a real long session over its own history: 892px of drift before,
1px after.

**Fix.**

- `SessionChat` keeps a key base: the number of updates the cap has dropped
  since mount, found by object identity (`droppedFromFront`,
  `lib/transcriptKeys.ts` — the cap slices, so survivors keep their identity).
  `deriveTranscriptRows` adds it to every index key. The first eight leading
  updates are probed, not just the first: the new front can be a fresh copy
  when a tool frame or a permission folds into it in the same update.
- While reading, `transcriptRestoreMode` returns `"reading"` and MVCP runs with
  `{data: true, size: true}`, restoring only the topmost row visible by
  geometry (`topmostVisibleRowId`), so a row trimmed from the front no longer
  pulls the text away. The anchor is captured on detach and refreshed only by
  the user's own scrolls; the refresh window slides with each scroll event so a
  smooth-scroll tail still counts.

**Regression on the way.** The first version probed only the first update. When
that update had been replaced by a copy, the count came out zero, every key
shifted by one, and cached heights were applied to the wrong rows: rows drew on
top of each other.

### Invariants (continued)

16. **Keys must survive the cap trim.** A miscounted key base re-assigns cached
    heights to the wrong rows — the list trusts `sizesKnown` by key, and a
    container that happens to keep its size never re-measures. Any new key
    scheme must name the same update across a front trim.
17. **The reading anchor comes from geometry and user scrolls only.** Not from
    DOM order (containers are recycled out of order), and never refreshed from
    the list's own compensating scrolls, which would re-anchor mid-relayout.
18. **Nothing may be removed above a mounted list uncompensated.** Invariant 2
    forbids prepends; the cap's front trim is the same kind of change and is
    safe only because of Invariants 16 and 17.
