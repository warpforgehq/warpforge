# 0011 — A session runs one turn at a time, and every turn says who asked for it

**Status:** accepted (2026-09-16)

## Context

The ACP session driver used to dispatch `session/prompt` the moment a prompt
arrived. A real adapter answers only the turn it is on, so a second prompt made
it end the first early; the driver emitted `TurnEnded` for a turn nobody had
finished, and the actor read that as *the task* finishing — status flipped to
`Waiting` and the task's whole text so far was flushed as a result into the
orchestrator inbox, the automation run, or the workflow stage.

Serializing the prompts fixed the overlap but not the bookkeeping around it.
Two gaps were left:

- **A queued prompt's turn was invisible.** `SessionPrompt` marked the task
  `Running` when the *user pressed send*. For a message that would sit in the
  queue for a minute that was a lie, and the running turn's end then parked the
  task at `Waiting` — where it stayed while the queued message ran.
- **Turns were anonymous.** `TurnEnded` carried a stop reason and nothing else.
  The daemon could not tell a user's follow-up from an automation dispatch or a
  workflow nudge, nor a turn the agent finished from one something cut short.
  Every consumer of a finished turn therefore fired on every turn.

## Decisions

**The session driver owns the queue, not the actor.** `src/daemon/acp/session/turn.rs`
holds a `VecDeque` behind one outstanding `send_prompt`. Only the driver knows
whether a prompt went out or is waiting, and that is the fact every other
decision here depends on.

**A turn is announced, not inferred.** The driver emits `AcpUpdate::TurnStarted`
when a prompt actually leaves, and that — not the RPC that submitted it — is
what sets the task `Running`. `TurnEnded` then means one specific turn, the one
that started.

**`TurnEnded` carries identity: `initiator` and `interrupted`.** `TurnInitiator`
(`Initial` / `User` / `System` / `Automation`) travels with the submission and
comes back on both updates. `interrupted` distinguishes a turn the agent
finished from one cut short for a queued message.

**Force-send is `session.interrupt`, a separate command from cancel.**
`AcpCommand::Cancel` stops the agent and drops the queue; `AcpCommand::Interrupt`
ends the running turn and keeps it. The cancelled turn gets `INTERRUPT_GRACE`
(5s) to answer its own `session/prompt`; past that the driver drops the send
task and reports the turn ended itself, so an agent that ignores
`session/cancel` cannot swallow the queue.

**It refuses when the queue is empty, and the refusal is the driver's to make.**
An empty queue means the click lost a race with the queue draining, and cutting
the turn then kills the message it was meant to hurry. Only the driver knows the
queue, so `AcpCommand::Interrupt` carries a reply channel and the RPC returns its
verdict; the chat surfaces the refusal rather than looking like a dead button.

**A turn's result is the turn's text, not the session's.** `request_task_output`
reads the in-memory turn buffer, which `TurnStarted` clears. It used to read the
whole persisted transcript, which re-delivered every earlier turn on each
follow-up and let an interrupted turn's fragment ride along inside the next
turn's answer — the one thing interrupting was supposed to prevent.

**Force-send sends the whole queue as one turn, not the next message.** At
interrupt the driver empties the queue into a single `PreparedPrompt::merge`
(order preserved, parts separated by a blank line) and dispatches that once the
slot frees. A person who typed three corrections while the agent was working
meant them as one instruction; delivering them as three turns makes the agent
act on the first two and then be corrected, which is the thing they pressed the
button to avoid.

**Only the user's own messages are batched.** An `Automation` or `System`
prompt caught in the queue keeps its place and runs as its own turn. Its
initiator is what decides whose answer a turn's output is, and a merge would
file a scheduled run's answer as a person's — and then fail the run on a turn
it never started.

**The merged turn's initiator is `User`.** Every part of it is a user message,
so nothing is misattributed.

**A message enters the transcript when the agent is handed it, not when it was
submitted.** `TurnStarted` carries the text to record (`AcpUpdate` →
`PromptEcho`) and the actor writes it there. Until then the message exists only
as a queue entry, which is what the chat shows above the composer. The
transcript is then exactly what the agent was told, in the order it was told —
a message that is still waiting has been said to nobody.

**A force-sent batch is recorded as one user message holding the merged text.**
That is the single prompt the agent received. Reading it back, the conversation
and the agent's input are the same thing.

**`Task::queued_prompts` is the queue itself — id, text and initiator per entry
— and is never persisted.** Clients render the waiting messages from it, so a
count is not enough. After a restart there is no session, so the only honest
value is an empty list; a column could only hold a stale one.

**A batch keeps counting as waiting until its turn starts.** `session.interrupt`
takes the messages out of the queue immediately but the agent only gets them
when the cancelled turn lets go — up to `INTERRUPT_GRACE` later. Dropping them
from `queued_prompts` at interrupt time would leave them in neither the queue
nor the chat, which is the disappearance this whole surface exists to prevent.

### Rejected

- **Queueing in the actor.** It would have to model "is a turn outstanding"
  in parallel with the driver that actually knows, and the two would drift.
- **A per-turn correlation id.** Updates from one session reach the actor over
  one ordered channel, so `TurnStarted` / `TurnEnded` already pair up. An id
  would add a per-task map to clean up and answer no question that is asked.
- **Status `Interrupted` for a force-sent turn.** Clients render it as a
  failure ("Session interrupted", destructive tone, attention rail). A turn the
  user deliberately cut short is not a failure; it yields to the human like any
  other, so it reports `Waiting`.
- **A `force` flag on `session.prompt`.** The action operates on messages that
  were already sent, so it cannot ride on the call that sends one.
- **A per-message "send this one now".** It would have to reorder the queue and
  leave the rest waiting behind a turn the user just interrupted — the queue
  order stops meaning anything, and the user has to press it once per message.
  The control is session-level and there is exactly one of it.
- **Echoing each queued message as its own bubble when the batch goes out.**
  It reads more naturally — three messages typed, three messages shown — but it
  describes an input the agent never received: it was given one prompt. The
  transcript is the record of what was said to the agent, so it stays literal.
- **Echoing at submit time and deleting the message if it never went out.**
  The transcript is append-only and persisted per update; a retraction would
  have to be a second update that clients know how to apply backwards.
- **A count instead of the queue.** `queued_prompts: u32` was the first shape.
  With the messages no longer in the chat, a count names something the user
  cannot look at.

## Invariants

1. **Never two outstanding `session/prompt` for one session.**
   (`src/daemon/acp/session/turn.rs`) The mock in
   `tests/fixtures/mock-acp-serial.mjs` logs `overlap` when the daemon breaks
   this; `src/daemon/tests/turns/` asserts the log has none.
2. **Nothing marks a task `Running` on prompt submission.**
   (`src/daemon/actor/commands/session.rs`) `TurnStarted` is the only source.
   The resume path is the exception, and is about the session starting, not a
   turn.
3. **An interrupted turn feeds no consumer.** (`src/daemon/actor/acp_update.rs`)
   No `request_task_output`, no `workflow_stage_finished`, and `pending_wake`
   stays set. Its text is a fragment; anything that treats it as an answer
   records half a thought as the agent's result. Skipping the consumers is only
   half of it — the fragment must also be out of the *next* turn's text, which
   is what clearing the turn buffer on `TurnStarted` is for.
4. **Only a non-`User` turn closes an automation run.**
   (`src/daemon/actor/commands/task.rs`) A `reuse_session` automation shares a
   task with whoever chats into it; a person's reply must not be filed as the
   scheduled run's output.
5. **The `session.prompt` RPC does not accept an initiator.** Clients would set
   it wrong or set it deliberately. The daemon assigns one per call site.
6. **A force-send emits one `session/prompt`, never one per queued message.**
   (`src/daemon/acp/session/turn.rs`) The batch leaves the queue whole and stays
   listed in `queued_prompts` until its turn starts.
   `src/daemon/tests/turns/force_send.rs` asserts the single prompt, the order
   of its parts, and the single merged message in the transcript.
7. **An interrupted turn still closes a linked automation run, as failed.**
   (`src/daemon/actor/commands/automation/runs.rs`) It is the one consumer that
   must hear about a turn that will never finish: a run left `Running` holds
   `automation_active`, and every later occurrence is skipped behind it.
8. **Exactly one place reports a turn over.** (`src/daemon/acp/prompt.rs`,
   `src/daemon/acp/session/turn.rs`) The send task and the cancel-grace deadline
   both can reach that point for the same turn, so they race for the turn's
   `ended` flag and the loser stays quiet.
9. **A turn's `session/prompt` is on the wire before `send_prompt` returns.**
   (`src/daemon/acp/prompt.rs`) Only the await is spawned. A prompt written from
   inside the spawned task can be overtaken by the driver's own
   `session/cancel`, leaving the agent running a turn nothing can stop.
10. **A force-send batches `User` prompts only.**
    (`src/daemon/acp/session/turn.rs`) Merging an `Automation` or `System`
    prompt into it would dispatch that prompt under a `User` initiator, which
    invariant 4 then keeps out of its own run's result.
11. **Only a turn the run itself started can fail that run as interrupted.**
    (`src/daemon/actor/acp_update.rs`) A person force-sending into a
    `reuse_session` automation's task interrupts *their* turn; failing the run
    for it reports a reason that never happened.
12. **Nothing writes a user message into the transcript on submission.**
    (`src/daemon/actor/commands/session.rs`) `TurnStarted`'s echo is the only
    source for a chat message, so the conversation cannot show the agent an
    input it was never given. The session-start path is the exception, and is
    about the prompt a session opens with.
