import type { PeerMessage, TaskInfo } from "../protocol";
import { taskLabel } from "./taskLabel";

/** How the feed names the user as a sender. */
export const USER_LABEL = "You";

const INTERNAL_TAGS = new Set(["automation", "dreaming", "runner", "workflow-stage"]);

/**
 * The daemon's peer visibility filter (ADR 0026 invariant 1), mirrored so the
 * composer offers only sessions the daemon will resolve a mention to.
 * @param task a task from the snapshot
 * @returns whether it is in its project's peer directory
 */
export function isPeerVisible(task: TaskInfo): boolean {
  return (
    !task.origin &&
    !task.parentTaskId &&
    !task.tags.some((tag) => INTERNAL_TAGS.has(tag)) &&
    task.status !== "done" &&
    task.settledOverride !== true
  );
}

/** One thread in the Team view: a project's channel, or the direct messages
 *  between two parties (the user is one possible party). */
export interface Conversation {
  key: string;
  project: string;
  kind: "team" | "dm";
  /** The two parties of a direct thread, task ids; `null` is the user. */
  parties: [string | null, string | null] | null;
  records: PeerMessage[];
  lastAt: number;
}

/**
 * @param record a feed record
 * @returns the key of the thread it belongs to
 */
export function conversationKey(record: PeerMessage): string {
  if (!record.toTask) return `${record.project}::team`;
  const [a, b] = [record.fromTask ?? "", record.toTask].sort();
  return `${record.project}::dm::${a}|${b}`;
}

/**
 * Group the feed into threads, each oldest first, threads newest first.
 * @param records feed records in any order
 * @param project only this project's threads, when given
 * @returns the threads
 */
export function buildConversations(
  records: Iterable<PeerMessage>,
  project?: string | null,
): Conversation[] {
  const byKey = new Map<string, Conversation>();
  for (const record of records) {
    if (project && record.project !== project) continue;
    const key = conversationKey(record);
    let conversation = byKey.get(key);
    if (!conversation) {
      const parties: Conversation["parties"] = record.toTask
        ? [record.fromTask ?? null, record.toTask]
        : null;
      conversation = {
        key,
        kind: record.toTask ? "dm" : "team",
        lastAt: 0,
        parties,
        project: record.project,
        records: [],
      };
      byKey.set(key, conversation);
    }
    conversation.records.push(record);
    conversation.lastAt = Math.max(conversation.lastAt, record.id);
  }
  for (const conversation of byKey.values()) {
    conversation.records.sort((a, b) => a.id - b.id);
  }
  return [...byKey.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * Records the user has not seen: newer than the Team view was last open, and
 * not the user's own.
 * @param records feed records
 * @param seenAt unix seconds the view was last open
 * @returns how many are unread
 */
export function unreadCount(records: Iterable<PeerMessage>, seenAt: number): number {
  let count = 0;
  for (const record of records) {
    if (record.createdAt > seenAt && record.fromTask) count += 1;
  }
  return count;
}

/**
 * Live message-limit alerts as needs-you reasons, on the task whose message
 * tripped the pair's window. An alert is live until `alertClearedAt` is set.
 * @param records feed records
 * @param label names a task by id
 * @returns reasons by task id
 */
export function peerAlertReasons(
  records: Iterable<PeerMessage>,
  label: (taskId: string) => string,
): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const record of records) {
    if (!record.alert || record.alertClearedAt != null || !record.fromTask) continue;
    const other = record.toTask ? label(record.toTask) : "the team";
    reasons.set(
      record.fromTask,
      `sessions ${label(record.fromTask)} and ${other} hit the message limit`,
    );
  }
  return reasons;
}

/** A session the composer can @mention. */
export interface MentionCandidate {
  id: string;
  label: string;
}

/**
 * @param tasks the snapshot's tasks
 * @param project the project whose channel is being written to
 * @returns the sessions a mention can name, by label
 */
export function mentionCandidates(tasks: TaskInfo[], project: string): MentionCandidate[] {
  return tasks
    .filter((task) => task.project === project && isPeerVisible(task))
    .map((task) => ({ id: task.id, label: taskLabel(task).split("\n")[0]!.trim() }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The `@` being typed at the caret: where it starts and what follows it. */
export interface MentionAtCaret {
  start: number;
  query: string;
}

const MAX_QUERY = 60;

/**
 * Find the mention being typed. Labels hold spaces, so the query runs from the
 * `@` to the caret on one line; the caller hides the menu when nothing matches.
 * @param text the composer text
 * @param caret the caret offset
 * @returns the mention, or null when the caret is not in one
 */
export function mentionAtCaret(text: string, caret: number): MentionAtCaret | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > MAX_QUERY) return null;
  return { query, start: at };
}

/**
 * @param candidates the sessions a mention can name
 * @param query what follows the `@`
 * @returns label-prefix matches first, then other label or id matches
 */
export function rankCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.toLowerCase();
  const score = (c: MentionCandidate) => {
    const label = c.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.includes(q)) return 1;
    if (c.id.toLowerCase().includes(q)) return 2;
    return 3;
  };
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .filter((entry) => entry.score < 3)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.candidate);
}

/**
 * What to insert for a picked session: its label when no other candidate
 * shares it, otherwise its id, so the daemon resolves it to one session.
 * @param picked the chosen session
 * @param candidates every session a mention can name
 * @returns the mention text, `@` included
 */
export function mentionText(picked: MentionCandidate, candidates: MentionCandidate[]): string {
  const label = picked.label.toLowerCase();
  const shared = candidates.some((c) => c.id !== picked.id && c.label.toLowerCase() === label);
  return `@${!picked.label || shared ? picked.id : picked.label}`;
}

/**
 * Replace the mention being typed with the picked one.
 * @param text the composer text
 * @param mention the mention at the caret
 * @param caret the caret offset
 * @param insert the mention text to put in
 * @returns the new text and caret
 */
export function applyMention(
  text: string,
  mention: MentionAtCaret,
  caret: number,
  insert: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, mention.start)}${insert} ${text.slice(caret)}`;
  return { caret: mention.start + insert.length + 1, text: next };
}
