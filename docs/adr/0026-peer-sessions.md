# 0026 — Parallel sessions see each other in a directory and message as peers

**Status:** proposed (2026-10-16) — draft

## Context

Two top-level task sessions in one project did overlapping work. Neither knew
the other existed; one helped the other only after shelling out to discover
its session name, because task ids are opaque and nothing lists who else is
working. The only agent-to-agent channel today is the orchestrator's
(`spawn_agent` / `message_agent` / `read_inbox`), which is a parent talking to
the children it spawned.

Peers are symmetric: neither owns the other, neither's result is the other's
input. This is not the orchestrator and must not grow into one. Persistent
named agents ("Smiths", later) will appear in the same directory, so the
directory entry has a kind.

The owner wants to watch the conversation, not reconstruct it from several
agents' chats. That makes the messages themselves the record, with a view of
their own.

*Rejected:* a fixed per-project team roster. Teams form ad hoc around a goal
and dissolve with it; the project is only the visibility boundary. A "crew per
goal" — a backlog item claimed by several peers — is future work that builds
on the directory and feed here.

`message_agent` (`src/mcp/handle/agents.rs`) does not check that its target is
the caller's child: it calls `session.prompt` with whatever `task_id` it is
given. `stop_agent` and `cleanup_agents` do check, through
`list_owned_agents`. Routing `message_agent` through the daemon (below) closes
that gap. The child's turn still arrives as `User`, because that path keeps
today's behaviour; giving it its own initiator is a separate fix.

## Decisions

**A directory, one filter.** `Command::Peers(PeerCommand)` — a nested enum
handled by one exhaustive `match` in the actor's peers module, the shape of
`Command::Runner(RunnerCommand)`. The actor's command chain ends in a
fall-through, so a variant added to `Command` itself would compile and do
nothing (CLAUDE.md, module layout). RPC `peers.list`, served through
`list_agents` (below).
Visibility is one function, `is_peer_visible(&Task)`:

- `origin.is_none()` (advisor, PR review and other hidden tasks);
- `parent_task_id.is_none()` (orchestrator children, workflow stages);
- none of the internal tags `automation`, `dreaming`, `runner`
  (`RUNNER_TAG`), `workflow-stage`;
- not settled: `status != Done` and `settled_override != Some(true)` — the
  same rule as the desktop's `isSettledTask` and the store's `SETTLED_TASK`.
  Archiving sets `Done`; settling sets only `settled_override`.

Snoozed tasks (`snoozed_until` in the future) stay visible and are marked
`snoozed`: a snooze hides a task from its owner's attention, it does not stop
the session. Orchestrator parents are visible and marked (tag `orchestrator`).
The caller is never in its own list. The filter applies to the caller too: a
hidden caller (a stage, an automation run, an orchestrator child, a settled
task) sees an empty list and is refused on the peer and team paths, since no
peer could answer it. Scope is the caller's project; other projects are opt-in
(phase 2). `peers.list` and `peers.controls` read actor memory through the
mailbox: ADR 0002's state snapshot for reads does not exist yet, and every
task-derived read still goes this way.

**The entry is metadata, never content.** `PeerInfo`: `id`, `kind` (`task`
now, `smith` later), `title` (falls back to the first line of the prompt),
`agent`, `model`, `status`, `blocked_kind`, `snoozed`, `project`, `worktree`,
`base_branch`, `files_changed` (a hint, not a file list), `updated_at`, `note`,
`name` (`None` for a plain task; a Smith's name later). No prompt text beyond
that fallback line, no transcript, no file contents. A peer that wants more
asks.

**One label everywhere.** Tool output, digests, transcript entries and the
Team view name a peer through one function, `peer_label`: `name · title` when
a name exists, otherwise `title`. Smiths then appear with their names in every
surface by filling `name`, without touching the tools or the views.

**A status note says what a session is doing.** `set_status_note(text)` sets a
short note on the caller's task (clipped, ~200 characters, to tune). In memory
only, like `queued_prompts`: after a restart the honest value is empty. A muted
session's note is withheld from `peers.list`.
*Rejected:* deriving it from the last assistant message — that is transcript
content, and it is usually mid-thought.

**Peer messages are persisted records, and the feed is their view.** A
`peer_messages` table (`src/daemon/store/peers.rs`): `id` (monotonic, numbered
by the actor), `project`, `from_task` (null = the user), `to_task` (null = a
channel post), `text`, `created_at`, `delivered_at`, `status`, `reason`,
`alert`, `alert_cleared_at`. Status is one of:

- `queued` — accepted into a live session's queue;
- `held` — accepted for a visible peer with no live session (idle after a
  restart, session ended). It is not woken: the message rides the digest of
  its next prompt, like a post. The sender's guard slot is released at once
  and the tool says "<label> is not running; it will see your message when it
  is next resumed";
- `posted` — a channel post; nobody has read it yet;
- `delivered` — a turn started with it;
- `refused` — `reason` names the rule.

A record is written for every attempt the guard or routing refuses, through
the actor's write-behind queue like every other store write (ADR 0007). An
address that is not a task in the caller's project, or the caller itself, is an
invalid request: the tool gets an error and no record is written, so the feed
does not fill with junk ids. Live changes go out as `Event::PeerMessageUpdated`
(`peer.messageUpdated`); `peers.feed` flushes the queue and pages the store off
the actor loop (ADR 0002). On startup, `queued` records are marked `refused`
(`daemon restarted`): session queues are not persisted (ADR 0011). `held`
records survive. Per-task digest cursors and the user's mutes and pauses are
persisted next to the records; deleting a task drops its cursor, its mute and
its guard counters, and keeps its records.

**The existing agent tools grow a peer half; only one tool is new.**

- `list_agents` returns the caller's children and its peers, each entry with
  `relation: child | peer`. The children section is unchanged, from
  `orchestrator.listAgents`; peers follow, from `peers.list`. A session that is
  not an orchestrator has no children and sees only peers.
- `message_agent(task_id | "team", message)` goes to a new RPC,
  `session.message`, and the daemon resolves the relation from the caller's
  task: a child (`parent_task_id` = caller) gets today's follow-up; a visible
  peer takes the peer path — guard, framing, `TurnInitiator::Peer`, feed
  record; `"team"` is a channel post; anything else is refused. The parameter
  keeps its current name, `message`.
- `stop_agent` and `cleanup_agents` stay child-only and orchestrator-only.
- `set_status_note` is the only new tool.

Both descriptions say they cover Warpforge sessions across every harness, by
task title, so an agent does not confuse them with its harness's own built-in
agent listing.

The split is in two places. `tool_defs(is_orchestrator)`
(`src/mcp/tools/mod.rs`) appends `orchestrator::defs()` — one array holding all
twelve orchestrator tools, `list_agents` and `message_agent` among them — only
for an orchestrator. Those two definitions move out of `orchestrator.rs` into
`src/mcp/tools/peers.rs`, appended for every session next to
`set_status_note`; the orchestrator array keeps the other ten. In
`src/mcp/handle/mod.rs` the seven-name arm to `agents::dispatch` sits below the
`_ if !is_orchestrator` gate; `list_agents` and `message_agent` leave it for an
arm above the gate that dispatches to `src/mcp/handle/peers.rs`, and the other
five stay below.

**A direct message is a turn.** The peer path of `session.message` is the
existing `Command::SessionPrompt` with a new `TurnInitiator::Peer`. It needs its
own RPC because `session.prompt` does not accept an initiator (ADR 0011
invariant 5), and because only the daemon can tell a child from a peer. The receiver's session driver
queues it behind the running turn like any prompt. A blocked peer is refused; a
peer with no live session gets the message `held` (above), never woken. The
record id rides on the queued prompt and comes back on `TurnStarted`, which sets
`delivered_at` and `status: delivered` and frees the sender's slot.

**A channel post never starts a turn.** `message_agent("team", …)` writes a record
with `to_task` null and wakes nobody. Each visible peer receives unseen posts,
and direct messages held for it, passively: when the actor prepares that peer's next prompt
(`Command::SessionPrompt`, and the opening prompt in `start_session`), it
prepends a short digest. Held direct messages come first, whole and oldest
first, at most 10 or 8,000 characters (the first always); the rest stay held
for the next prompt — the sender was told they would arrive, so none is
clipped or refused for space. Channel posts fill their own budget, at most 10
or 2,000 characters, newest kept, "N older posts omitted" (to tune). A prompt
with no content of its own gets none. A task's first digest starts at posts
made since it was created; the actor keeps the last 100 posts per project for
this. A per-task
cursor, persisted next to the records, advances when that prompt's turn
starts, not when it was prepared; a turn that never starts leaves the posts
unseen. What a waiting prompt carries is reserved so a second queued prompt
does not repeat it; the reservation lapses when the task goes idle with
nothing queued, or its session goes away. Posts made while a prompt sits in
the queue go out with the next one. *Rejected:* waking every peer on a post
— a broadcast that starts N turns multiplies cost by N, and most posts are
"for your information".

**The transcript references the record.** New
`SessionUpdate::PeerMessage { message_ids, from_task, from_label, to_task,
to_label, text, direction }`, `direction` one of `sent` / `received` /
`digest`. The receiver's `received` (or `digest`) entry is written at
`TurnStarted`, carried on the prompt as every echo is (ADR 0011 invariant 12);
the sender's `sent` entry, with the receiver (or `team`) as `to_*`, when
routing accepts the message, queued or held. A queued `Peer` prompt names its
record in `QueuedPrompt.peer_message_id`. The user removing it from the queue
refuses the record; losing it any other way — the session ends or fails, the
transport refuses the prompt — holds it, since the session can be resumed.
Every session teardown and start failure goes through one function,
`Daemon::drop_session`: in-flight direct messages are held, their senders'
slots freed, digest reservations dropped. Lifecycle updates (`TurnStarted`,
`QueueChanged`, `TurnEnded`) carry the session's run id, and one from a run
other than the task's live session is discarded before it changes anything; a
`TurnStarted` arriving after its session was dropped delivers nothing, since
the drop already held what it carried. A queued
`Peer` prompt cannot be edited (only `User` ones can), and a force-send needs
a queued `User` prompt to cut the running turn short. Rendering these entries
as one compact attributed line with a click-through to the other task, as
`WorkflowEventLine` does, is desktop work (#116). `System` turns stay
un-echoed.

**Team is a global view in the sidebar.** A `GlobalView` `"team"`
(`desktop/src/store/ui/types.ts`) with a `NAV` entry next to Automations and
Memory (`desktop/src/components/Sidebar/nav.ts`), laid out like those two:
`desktop/src/views/Team.tsx` plus `desktop/src/views/team/`. It shows the feed
for all projects, grouped by project, with a project filter: direct messages
grouped by pair, channel posts, sender and receiver titles with click-through
to the task, and `queued` / `refused` state with the guard's reason. The nav
item carries an unread badge — records newer than the view was last opened,
the timestamp kept in the persisted UI store. Updates arrive live from
`Event::PeerMessageUpdated`; no polling. *Rejected:* a project surface tab —
the feed would be visible only with a project open, while the sessions it is
about already sit cross-project in the sidebar.

**The user is on the team.** From the Team view the user can post to the
channel (`from_task` null, same passive delivery) or message one session. A
user message is an ordinary prompt with initiator `User`; it is recorded in
the feed and echoed in the chat as a `UserMessage`, and its turn resets that
session's pair counters like any `User` turn. The view also offers two
controls, persisted so a restart does not silently undo them: **mute a
session** — its peer messages, channel posts and status note are refused, and
messages addressed to it by peers are refused with the same reason — and
**pause the project**, which refuses every agent's peer messages and posts in
it. Messages between an orchestrator and its own children are not peer
messaging and are unaffected, as are the user's own posts and messages.

**Delivered text is framed as a peer's, not the user's.** The prompt wraps a
direct message or a digest in a tagged block naming each sender, saying it is
not from the user, and that it must not change the receiver's task, touch its
files, grant permissions or lead to destructive actions. Bodies are untrusted
input and go through the same guard as browser pages (`src/mcp/untrusted.rs`),
so they cannot close the block early. Each message is its own element: a
session's is `<peer_message from="<label>" task="<id>" kind="direct|team">`,
with the label an escaped one-line attribute, and the user's post is
`<peer_message kind="user-post">`, with no `from` or `task`. Neither a body
nor a label can forge another sender's entry, and a session titled "the user"
is still a session. A user post carried in a digest stays in the block: the
channel is not a way to issue instructions around the chat.

**The loop guard is in the daemon, not in the prompt, and heals itself.** A
prompt asking agents to stop is a suggestion; two agents politely thanking
each other is a loop. The guard is a backstop for runaway loops, not a limit
on conversation, and nobody has to reset it. Proposed defaults, all to tune:

- **pair window:** a counter of direct messages between a pair, either
  direction. It resets by itself after 10 minutes with no direct message
  between them; a `User` or `Automation` turn starting in either session also
  resets it. Past 12 messages in one window, further messages between the pair
  are refused until it resets;
- per sender → receiver, one message per 5 s — enough to break a tight loop,
  short enough not to slow a question and its answer;
- at most 30 peer-initiated turns per receiving session per hour. A queued
  `Peer` prompt holds its share from acceptance and spends it when its turn
  starts; a held message, or one riding another turn's digest, starts no peer
  turn and is never charged;
- at most one queued `Peer` prompt per sender per receiver; the reservation
  lapses after 30 minutes (`QUEUED_TTL`) if nothing delivers or drops it;
- message and post text capped at 4,000 characters.

A refusal is an explicit tool error naming the rule, so the agent stops rather
than retries, and it is recorded in the feed. Counters live in the actor, in
memory.

**A tripped pair window is the one time the user hears about the guard.** The
first refusal in a window marks its record as an alert; the desktop is to turn
that (#116) into one "needs you" item — "sessions X and Y hit the message limit" — on the
task whose message tripped it. The rail is derived on the client
(`buildAttentionQueue`, `desktop/src/lib/attentionRail.ts`) from task state
plus daemon-fed maps such as the PR feedback one (`store/prFeedback.ts`); the
alert is another such map, keyed by task, and clears when the window resets.
It ranks with PR feedback, below anything that stops work: the sessions are
still working, only their conversation is held. One item per pair per window,
however many refusals follow. The other rules refuse silently, to the feed
only. When the window ends — 10 quiet minutes, a `User`/`Automation` turn, a
deleted task or a restart — the alert record gets `alert_cleared_at` and is
re-emitted; an alert is live while that is null. Time-based ends are found by
`PeerCommand::Tick`, sent with the automation and runner ticks every minute, so
no new message is needed to clear one.

**Overlap hint (phase 2).** When two visible peers' worktrees change the same
files, the daemon posts a note to both. The file sets come from git on demand,
at most once per check interval; `peers.list` never runs git.

**`list_agents`, `message_agent` and `set_status_note` exist in Single,
Advised and Orchestrator sessions, never in an Advisor.** The advisor's bridge
serves only `READ_ONLY_TOOLS` (`src/mcp/tools/advisor.rs`) and none of the
three is on it.

**New topic files.** `src/mcp/tools/peers.rs` (the three always-on
definitions), `src/mcp/handle/peers.rs`,
`src/daemon/actor/peers/`, `src/daemon/server/dispatch/peers.rs`,
`src/daemon/store/peers.rs`, and `desktop/src/views/Team.tsx` with
`desktop/src/views/team/`. Nothing grows `src/mcp/handle/agents.rs`,
`src/daemon/actor/commands/session.rs` or `src/daemon/actor/commands/git.rs`
(562 lines, already over the cap).

### Rejected

- **Separate peer tools** (`list_peers`, `message_peer`, `post_to_team`). More
  tool surface in every session's context, and two tools answering "who can I
  talk to".
- **Reusing `orchestrator_inbox` / `read_inbox`.** The inbox is keyed by
  parent, drained only by orchestrator tools, and exists to carry a child's
  *result*. Peers would need a second addressing model inside it and a polling
  tool every session must remember to call, for nothing a turn does not
  already give: a busy peer gets the message when it is free.
- **Reconstructing the feed from transcripts.** Each side's chat holds only
  its own half, a refusal appears in neither, and a channel post belongs to no
  one's transcript.
- **Force-sending into a busy peer.** It would cut a turn its own user is
  watching for a message from someone else.
- **Forbidding replies to the sender.** It stops ping-pong but also stops the
  answer the message asked for.
- **A hop budget that only a `User` or `Automation` turn resets.** Every long
  exchange would stall until someone stepped in, which makes the owner police
  conversations. A window that decays on quiet ends a loop without anyone.
- **A long per-pair cooldown (60 s).** It throttled every question and answer
  to stop a case the pair window already stops.
- **Letting the prompt carry the loop guard.** Agents follow it until they do
  not; the daemon is the only place that sees both ends.
- **Listing other sessions' transcripts or diffs.** A directory that leaks
  content turns every session into a reader of every other.

## Invariants

1. **One visibility filter.** (`actor/peers/` `is_peer_visible`) `peers.list`,
   the peer path of `session.message`, digest delivery and the overlap hint all call it. Settled
   tasks are out, snoozed ones in. A message to a task the list would not
   show — an advisor, a stage, an automation run, a settled task — is refused.
2. **The record is written before delivery.** (`actor/peers/`) The record is
   in the store queue and its event emitted before the prompt is submitted.
   Nothing reaches an agent that the feed does not show.
3. **A channel post or a held message never starts a turn.** (`actor/peers/`)
   Both ride on a prompt that something else submitted. A path that submits a prompt because
   a post exists turns every post into N turns.
4. **A `Peer` prompt never joins a force-send batch.**
   (`src/daemon/acp/session/turn.rs`) The partition keeps `User` only; a merge
   would file a peer's text as the user's (ADR 0011 invariant 10).
5. **A `Peer` turn feeds no automation run.** (`actor/commands/task.rs`,
   `actor/acp_update.rs`) Both sites ask `TurnInitiator::feeds_automation`:
   `Automation` or `Initial` — a run in a task it created ends on its opening
   turn. A test for `!= User` lets a peer's answer close or fail a
   `reuse_session` run.
6. **Delivery is marked at `TurnStarted` only.** (`actor/acp_update.rs`)
   `delivered_at`, the digest cursor and the receiver's transcript entry all
   move there. A queued message has been said to nobody.
7. **The entry carries no content.** (`PeerInfo`) Adding a field means
   checking it cannot hold prompt, transcript or file text.
8. **`from` is advisory, never a trust boundary.** The caller's task id is
   what its bridge read from its environment (ADR 0018); nothing proves it.
   Nothing may grant a peer more because of who it claims to be.
9. **The guard refuses, it does not drop.** A blocked message returns an error
   to the sender and a `refused` record with its reason. Nothing is silently
   discarded. An invalid address is not a refusal: it gets an error and no
   record.
10. **The guard needs no one to reset it.** (`actor/peers/`) Every limit
    expires on time alone; a `User` or `Automation` turn may reset one early,
    never be required to.
11. **One alert per pair per window.** (`actor/peers/`) Only the first refusal
    in a window is marked; a loop that keeps retrying must not fill the rail.
12. **Mute and pause are enforced in the daemon.** (`actor/peers/`) A view
    that hides a muted session's messages while its tools still work is not a
    mute.
13. **Advisor bridges never serve `list_agents`, `message_agent` or
    `set_status_note`.** (`src/mcp/serve.rs`, `READ_ONLY_TOOLS`) `list_agents`
    only reads, but it names other sessions; it does not go on the list.
14. **The daemon resolves `message_agent`'s target, not the bridge.**
    (`session.message`) A bridge-side check is the gap this closes. The
    ownership check is as strong as the caller's self-reported task id
    (invariant 8), no stronger.
15. **`stop_agent` and `cleanup_agents` never reach a peer.**
    (`src/mcp/handle/agents.rs`) They stay behind the orchestrator gate and
    `list_owned_agents`; a peer is not anyone's to stop.

## Consequences

- Peers converse freely; a runaway exchange stops at 12 messages, raises one
  "needs you" item, and the pair can talk again after 10 quiet minutes with no
  one stepping in. A chain through a third peer is bounded by each pair's
  window and the receiving session's hourly cap.
- The pair window is a per-pair limit, not a cost limit: up to 12 turns per
  pair per window can be spent before it trips.
- A channel post reaches a peer only when that peer next works. An idle peer
  never reads the channel until someone gives it a turn — by design.
- The sender is not authenticated (ADR 0018's known limit). Accepted for v1:
  the worst case is a message with a wrong name on it, framed as untrusted.
- The feed and held messages survive a restart; notes, guard counters and
  queued deliveries do not.
- `QueuedPrompt.initiator` gains `peer`, so the chat can show whose message is
  waiting once the desktop renders it (#116).

## Phases

1. Directory, status note, direct messages, persisted records, transcript
   entries, loop guard and its alert, the Team view with mute and pause, and channel
   posts with their digest. The feed is the observability for the whole
   feature, so it ships with it. The digest ships too: without it
   a `"team"` post is a message no agent reads, and agents would learn
   to use direct messages instead — the path that wakes peers and costs turns.
   It is small: a prefix at prompt preparation and a cursor moved at
   `TurnStarted`.
2. Overlap hint; cross-project opt-in setting.
3. Smiths in the directory (`kind: smith`).

## Addendum (2026-10-17): @mentions and starting a session from a post

The owner wants Team to be where they hand out work, not only where they
watch it. Two additions, owner-approved.

**A mention in a user's post is the user's instruction to that session.** The
user posts to the channel through `peers.userPost { project, text }`. The
daemon resolves every `@` at the start of the text or after a character that
is neither a word character nor `@` (so `(@docs` and `x/@docs` are mentions,
`me@docs` is not) against the project's visible peers (invariant 1): by label — the longest label the text after `@` starts
with, case-insensitive, ending at a word boundary — or by task id, whole or a
prefix of at least four characters of its hex part (`@t_ab12`, `@ab12`). Two
sessions matching the same mention is an invalid request, like an invalid
address (invariant 9): the sender gets an error listing the candidates with
their ids, and no feed record is written. An `@` that matches nobody is text — posts
quote code and addresses. Each mentioned session gets the post as an ordinary
prompt with initiator `User`: it wakes the session (resuming a saved one, as
the chat does), reads as the user's instruction, is echoed as a `UserMessage`
and resets that session's pair windows. Everyone else gets the post in its
digest as before.

**A mention in an agent's post is a direct peer message.** `message_agent
("team", …)` with mentions records the post, then sends each mentioned peer
the text through the direct path — guard, framing, `TurnInitiator::Peer`, its
own record with `source_id` naming the post. A refused or held mention does
not refuse the post. *Rejected:* waking a mentioned session as `User` from an
agent's post — that would let one agent command another by `@`, the gap the
framing exists to close.

**One record links a post and what it caused.** `PeerMessage` gains
`mentions` (the task ids the post reached: a `User` prompt accepted, or a
direct message queued or held), `source_id` (the post a direct message or a
start line came from) and `started_task`. A post does not ride the digest of a
session it already reached through a mention.

**The user can message one session from Team.** `peers.userMessage { task_id,
text }` is the chat's prompt with initiator `User`, plus a record from the
user. Its status is `delivered` once the session accepts the prompt — queued
behind a turn or resuming — and `refused` with the error when it does not.
It is not tracked to `TurnStarted`: a user prompt carries no peer record, so
the peer delivery path stays the only one invariant 6 covers.

**Start a session from a post.** The desktop creates the task with New Task's
agent and model picking and the post text as its prompt, then calls
`peers.userStarted { task_id, source_id }`, which records a channel line from
the user with `started_task` set and status `posted`. The line is never in a
digest: it tells the user where the work went, not the team.

**Live alerts are read on their own.** `peers.alerts {}` returns every record
whose alert is live, from the actor's memory, so a client that pages only the
newest records still raises the needs-you item for an older one.

**Known limit: the user's RPCs trust the client.** `peers.userPost` and
`peers.userMessage` speak as the user to any client holding the daemon token,
an agent's included — the same as `session.prompt` today. Client identity is
the daemon-wide question of ADR 0017 and ADR 0018, not a peer one.

### Invariants (addendum)

16. **A mention from the user is a `User` turn; a mention from an agent is a
    peer DM.** (`actor/peers/mention.rs`) An agent's `@` goes through the
    guard and the framing like any direct message, never as `User`.
17. **A post without a mention still starts no turn.** (invariant 3) Mentions
    are the only way a post wakes anyone, and only the sessions it names.
18. **An ambiguous mention posts nothing.** It is an invalid request: an
    error with the candidates and their ids, and no feed record. A post never
    reaches a session the sender did not pick.
19. **One record per post.** The post's record carries `mentions`; a user
    mention adds no record of its own, an agent mention adds the direct
    message's record with `source_id`. The feed shows what a post caused
    without reconstructing it.

## Addendum (2026-10-17): named channels per project

Beyond the one project channel the user can create named channels in a
project — `#ci`, `#release` — and choose which Smiths (ADR 0027) are in them.

**A channel is (project, name).** Every project has `#general`, which is the
project channel this record has always described: a record with no channel is
a `#general` post, so nothing already stored changes meaning. Named channels
are rows in `channels` (`id`, `project`, `name`, `created_at`); a name is one
lowercase word (`a-z`, `0-9`, `-`, `_`, at most 32), unique in its project,
and `general` is reserved. `peer_messages.channel_id` is null for `#general`.

**Members are Smiths, chosen by the user.** `channel_members` (`channel_id`,
`smith_id`). A Smith's thread is the member: it reads and posts in every
channel it is in, in any project it is allowed in. Plain sessions and a Smith's
work sessions are in `#general` only — they are short-lived, and a work
session's conversation goes through its thread. Deleting a Smith removes its
memberships; deleting a channel keeps its records, which then reach no digest.

**Delivery is the digest's, unchanged in kind.** A post to any channel starts
no turn (invariant 3); its @mentions follow the addendum above. At prompt
preparation a session's digest covers unseen posts of `#general` in its own
project (for a thread, its home project, as ADR 0027 says) and of every channel
it is a member of, each post labelled with its channel, under the same caps.
*Deviation from the brief:* the cursor stays one per task, not one per
(task, channel). Record ids are global and increase with every record, so one
cursor already orders every channel's posts, and caps, reservations and the
"N older posts omitted" count work over all of them at once. A per-channel
cursor would add a table key and change nothing a session sees. Joining a
channel shows its posts made after the cursor, not its history.

**Agents post; only the user manages.** `message_agent("#name", …)` posts to a
channel the caller's Smith is a member of, in any project it is allowed in;
`#project/name` picks one when two projects share the name. `"team"` and
`"#general"` are the caller's own project's `#general`. Anything else is refused
with no record, like an unknown address. Creating, renaming and deleting
channels and changing membership are user-only RPCs (`method_is_user_only`, for
#120). Mute and pause stay per session and per project. `list_agents` gains a
Channels section: `#general` and the caller's member channels.

### Invariants (addendum)

20. **A record with no channel is a `#general` post.** No migration rewrites
    old records, and no reader may treat a null channel as "no channel".
21. **Channel membership is the user's.** No agent-callable path creates a
    channel or changes its members; a post to a channel the caller is not in
    is refused.
