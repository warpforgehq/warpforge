import type { PeerMessage, SessionUpdate, Smith, SmithHold, TaskInfo } from "../protocol";
import { isSettledTask } from "./taskGroups";
import { taskLabel } from "./taskLabel";

/** A board assignee that names a Smith: its stable id, never its name. */
const SMITH_ASSIGNEE = "smith:";
const NAME_MAX = 32;

/**
 * The daemon's name rule (`src/daemon/smiths/mod.rs` `check_name`): one
 * mentionable word.
 * @param name the proposed name
 * @param others the other Smiths, for the case-insensitive uniqueness check
 * @returns why it cannot be a name, or null when it can
 */
export function smithNameError(name: string, others: Pick<Smith, "name">[] = []): string | null {
  const chars = Array.from(name);
  if (chars.length === 0) return "A smith needs a name.";
  if (!/^\p{Alphabetic}$/u.test(chars[0]!)) return "Start the name with a letter.";
  if (chars.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters.`;
  if (!chars.every((c) => /^[\p{Alphabetic}\p{N}_-]$/u.test(c))) {
    return "Use one word: letters, digits, - or _.";
  }
  const lower = name.toLowerCase();
  if (others.some((other) => other.name.toLowerCase() === lower)) {
    return `There is already a smith called ${name}.`;
  }
  return null;
}

/**
 * @param id a Smith's id
 * @returns the board assignee that names it
 */
export function smithAssignee(id: string): string {
  return `${SMITH_ASSIGNEE}${id}`;
}

/**
 * @param assignee a board item's assignee
 * @returns the Smith id it names, or null for a person or nobody
 */
export function smithIdFromAssignee(assignee: string | null | undefined): string | null {
  return assignee?.startsWith(SMITH_ASSIGNEE) ? assignee.slice(SMITH_ASSIGNEE.length) : null;
}

/**
 * How the board shows an assignee: a Smith by its name, a deleted one as such,
 * anyone else as written.
 * @param assignee a board item's assignee
 * @param smiths the Smiths by id
 * @returns the text to show, or null when unassigned
 */
export function assigneeLabel(
  assignee: string | null | undefined,
  smiths: Readonly<Record<string, Smith>>,
): string | null {
  if (!assignee) return null;
  const id = smithIdFromAssignee(assignee);
  if (id === null) return assignee;
  return smiths[id]?.name ?? "Removed smith";
}

export const HOLD_LABEL: Record<SmithHold, string> = {
  budget: "over its daily budget",
  identity_changed: "its soul or charter was edited outside Warpforge",
  paused: "paused",
};

/** What a Smith is doing, for its row and page. */
export type SmithStatus =
  | { kind: "held"; reasons: string[] }
  | { kind: "waiting"; note: string }
  | { kind: "working"; sessions: number; note: string | null }
  | { kind: "idle" };

/**
 * @param smith the Smith
 * @param tasks the snapshot's tasks
 * @returns its open work sessions, newest first; the thread is not one
 */
export function smithWorkSessions(smith: Smith, tasks: TaskInfo[]): TaskInfo[] {
  return tasks
    .filter((t) => t.smithId === smith.id && t.id !== smith.threadTaskId && !isSettledTask(t))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function shortTitle(task: TaskInfo): string {
  return taskLabel(task).split("\n")[0]!.trim();
}

/**
 * Held before anything else, then waiting on you (a question or a block in
 * any of its sessions), then working, else idle.
 * @param smith the Smith
 * @param tasks the snapshot's tasks
 * @returns its status, with a short note for the sidebar
 */
export function smithStatus(smith: Smith, tasks: TaskInfo[]): SmithStatus {
  if (smith.held && smith.held.length > 0) {
    return {
      kind: "held",
      reasons: smith.held.map((hold) => HOLD_LABEL[hold] ?? hold),
    };
  }
  const own = tasks.filter((t) => t.smithId === smith.id && !isSettledTask(t));
  const waiting = own.find((t) => t.pendingPermission || t.status === "blocked");
  if (waiting) {
    return {
      kind: "waiting",
      note: waiting.id === smith.threadTaskId ? "needs you" : `needs you: ${shortTitle(waiting)}`,
    };
  }
  const running = own.filter((t) => t.status === "running");
  if (running.length === 0) return { kind: "idle" };
  const work = running.find((t) => t.id !== smith.threadTaskId);
  return { kind: "working", note: work ? shortTitle(work) : null, sessions: running.length };
}

/**
 * How a teammate's soul reaches its sessions, for its page.
 * @param smith the Smith
 * @returns a short note, or null when the daemon did not say
 */
export function injectionNote(smith: Pick<Smith, "agent" | "injection">): string | null {
  if (smith.injection === "system_prompt") return "Soul delivered as system prompt";
  if (smith.injection !== "prefix") return null;
  return smith.agent === "claude"
    ? "Soul delivered as opening message — install claude-agent-acp 0.91 or later for system prompt"
    : "Soul delivered as opening message";
}

/**
 * Unread for one teammate: its sessions' feed records since the user last
 * opened its page, plus thread replies that ended since then.
 * @param smith the Smith
 * @param records feed records
 * @param tasks the snapshot's tasks
 * @param seenAt unix seconds its page was last open
 * @param repliesSince thread turns that ended since its page was last open
 * @returns how many things are new
 */
export function smithUnread(
  smith: Smith,
  records: Iterable<PeerMessage>,
  tasks: TaskInfo[],
  seenAt: number,
  repliesSince: number,
): number {
  const own = new Set(tasks.filter((t) => t.smithId === smith.id).map((t) => t.id));
  own.add(smith.threadTaskId);
  let count = Math.max(0, repliesSince);
  for (const record of records) {
    if (record.createdAt > seenAt && record.fromTask && own.has(record.fromTask)) count += 1;
  }
  return count;
}

/**
 * @param updates a session's transcript entries
 * @returns how many turns ended in it
 */
export function endedTurns(updates: readonly SessionUpdate[]): number {
  let count = 0;
  for (const update of updates) if (update.kind === "turn_ended") count += 1;
  return count;
}

/**
 * What a Smith says it is doing: its thread's status note, else a running
 * work session's.
 * @param smith the Smith
 * @param tasks the snapshot's tasks
 * @returns the note, or null when none is set
 */
export function smithOwnNote(smith: Smith, tasks: TaskInfo[]): string | null {
  const own = tasks.filter((t) => t.smithId === smith.id && !isSettledTask(t));
  const thread = own.find((t) => t.id === smith.threadTaskId)?.statusNote?.trim();
  if (thread) return thread;
  const working = own.find((t) => t.status === "running" && t.statusNote?.trim());
  return working?.statusNote?.trim() ?? null;
}
