/**
 * One request in a named channel, answered the way the daemon runs a channel
 * conversation: every member is woken, each reply is its turn's final message,
 * a member with nothing to add posts nothing, and the one who takes the work
 * starts a work session as itself.
 */
import type { DaemonEvent, PeerMessage, Smith } from "@app/protocol";

import { say, tool } from "../beats";
import type { Beat } from "../types";
import { ada, channel, oly, post, rex, threadOf, WORK_TASK_ID, workTask } from "./fixtures";

const record = (data: PeerMessage): DaemonEvent => ({ data, event: "peer.messageUpdated" });

const replying = (...smiths: Smith[]): DaemonEvent => ({
  data: { ...channel, working: smiths.map((s) => s.id) },
  event: "channel.updated",
});

const thread = (s: Smith, status: "running" | "waiting"): DaemonEvent => ({
  data: threadOf(s, status),
  event: "task.updated",
});

const TITLED = { ...workTask, title: "Export invoices as CSV" };

/**
 * @param now Epoch seconds when the scene started.
 * @returns The scene's beats.
 */
export function smithsScript(now: number): Beat[] {
  return [
    {
      after: 1200,
      event: record(
        post(1201, now, "@Ada @Rex invoices need a CSV export, someone take it", undefined, [
          ada,
          rex,
          oly,
        ]),
      ),
    },
    { after: 300, event: thread(ada, "running") },
    { after: 0, event: thread(rex, "running") },
    { after: 0, event: thread(oly, "running") },
    { after: 0, event: replying(ada, rex, oly) },

    {
      after: 2800,
      event: record(post(1202, now + 4, "I'm mid-way through the Express 5 upgrade. @Ada, yours?", rex, [ada])),
    },
    { after: 0, event: thread(rex, "waiting") },
    { after: 0, event: replying(ada, oly) },
    // NOTHING_TO_ADD: the turn ends and nothing is posted.
    { after: 1400, event: thread(oly, "waiting") },
    { after: 0, event: replying(ada) },

    // Ada's turn calls start_work: the work session is a board task as Ada.
    { after: 1600, event: { data: workTask, event: "task.created" } },
    { after: 300, event: say(WORK_TASK_ID, { kind: "user_message", text: workTask.prompt }) },
    { after: 400, event: { data: TITLED, event: "task.updated" } },
    {
      after: 500,
      event: record(
        post(1203, now + 9, "Taking it — I started a work session for the CSV export.", ada),
      ),
    },
    // Ada's post wakes the others; Rex's post is waiting for Ada as one more turn.
    { after: 0, event: replying(ada, rex, oly) },
    { after: 300, event: tool(WORK_TASK_ID, "w1", "Read api/src/routes/invoices.ts", "read", "in_progress") },
    { after: 700, event: tool(WORK_TASK_ID, "w1", "Read api/src/routes/invoices.ts", "read", "completed") },
    {
      after: 1500,
      event: record(post(1204, now + 13, "👍 I'll take the review when the PR is up.", rex)),
    },
    { after: 0, event: thread(rex, "waiting") },
    { after: 600, event: thread(ada, "waiting") },
    { after: 0, event: thread(oly, "waiting") },
    { after: 0, event: replying() },

    { after: 2400, ui: { openTaskId: WORK_TASK_ID, sidebarMode: "tasks", teamSelection: null, view: "control" } },
    { after: 600, event: tool(WORK_TASK_ID, "w2", "Write api/src/export/csv.ts", "edit", "in_progress") },
    { after: 900, event: tool(WORK_TASK_ID, "w2", "Write api/src/export/csv.ts", "edit", "completed") },
    {
      after: 100,
      event: say(WORK_TASK_ID, {
        additions: 20,
        deletions: 0,
        kind: "file_edit",
        path: "api/src/export/csv.ts",
        tool_call_id: "w2",
      }),
    },
    {
      after: 600,
      event: say(WORK_TASK_ID, {
        additions: 4,
        deletions: 0,
        kind: "file_edit",
        path: "api/src/routes/invoices.ts",
        tool_call_id: "w3",
      }),
    },
    { after: 400, event: tool(WORK_TASK_ID, "w4", "bun test api/test", "execute", "in_progress") },
    { after: 1300, event: tool(WORK_TASK_ID, "w4", "bun test api/test", "execute", "completed") },
    {
      after: 300,
      event: say(WORK_TASK_ID, {
        kind: "agent_text",
        text: "CSV export is in: `GET /invoices?format=csv`, validated like the JSON route. Writing the quoting and inverted-range tests next.",
      }),
    },
  ];
}
