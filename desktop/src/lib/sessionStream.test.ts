import { describe, expect, it } from "vitest";

import type { SessionUpdate } from "../protocol";
import {
  activityOpenState,
  appendCoalescedUpdate,
  automaticFoldAnchor,
  coalesceUpdates,
  deriveTranscriptRows,
  mergeSessionHistory,
  transcriptRowsAreEqual,
} from "./sessionStream";

describe("session stream coalescing", () => {
  it("collapses raw streaming chunks into one semantic message", () => {
    const raw: SessionUpdate[] = Array.from({ length: 10_000 }, () => ({
      kind: "agent_text",
      text: "x",
    }));

    expect(coalesceUpdates(raw)).toEqual([{ kind: "agent_text", text: "x".repeat(10_000) }]);
  });

  it("appends live deltas immutably without retaining separate chunk objects", () => {
    const previous: SessionUpdate[] = [{ kind: "agent_text", text: "Hello" }];
    const next = appendCoalescedUpdate(previous, { kind: "agent_text", text: "!" });

    expect(previous).toEqual([{ kind: "agent_text", text: "Hello" }]);
    expect(next).toEqual([{ kind: "agent_text", text: "Hello!" }]);
  });

  it("preserves historical update identity when the streaming tail changes", () => {
    const historical: SessionUpdate = { kind: "user_message", text: "Question" };
    const previous: SessionUpdate[] = [historical, { kind: "agent_text", text: "Ans" }];
    const next = appendCoalescedUpdate(previous, { kind: "agent_text", text: "wer" });

    expect(next[0]).toBe(historical);
    expect(next[1]).not.toBe(previous[1]);
  });

  it("folds completed consecutive work into one stable activity group", () => {
    const updates: SessionUpdate[] = [
      { kind: "user_message", text: "Inspect it" },
      { kind: "agent_thought", text: "Looking" },
      {
        kind: "tool_call",
        tool_call_id: "read-1",
        title: "Read file '/repo/src/a.ts'",
        status: "completed",
        tool_kind: "read",
      },
      { kind: "agent_text", text: "Done" },
    ];

    const rows = deriveTranscriptRows(updates, new Map(), null, null, true);

    expect(rows.map((row) => row.kind)).toEqual(["update", "activity", "update"]);
    const group = rows[1];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.items).toHaveLength(2);
    expect(group.expandable).toBe(true);
    expect(group.open).toBe(false);
    expect(group.summary.text).toBe("Read a.ts");

    const expanded = deriveTranscriptRows(updates, new Map([[group.groupId, true]]), null, null, true);
    const reopened = expanded[1];
    if (reopened.kind !== "activity") throw new Error("expected an activity group");
    expect(reopened.open).toBe(true);
    expect(reopened.id).toBe(group.id);
  });

  it("keeps a group's identity when the session cap drops its oldest lines", () => {
    const updates: SessionUpdate[] = [
      { kind: "agent_thought", text: "Looking at the two files" },
      {
        kind: "tool_call",
        status: "completed",
        title: "Read file '/repo/a.ts'",
        tool_call_id: "r1",
        tool_kind: "read",
      },
      {
        kind: "tool_call",
        status: "completed",
        title: "Read file '/repo/b.ts'",
        tool_call_id: "r2",
        tool_kind: "read",
      },
    ];

    const whole = deriveTranscriptRows(updates, new Map(), null, null, false)[0];
    const trimmed = deriveTranscriptRows(updates.slice(1), new Map(), null, null, false)[0];
    if (whole.kind !== "activity" || trimmed.kind !== "activity") {
      throw new Error("expected activity groups");
    }
    // The leading thought has no id, so an index-based key would change here and
    // orphan the reader's fold on every cap trim.
    expect(trimmed.groupId).toBe(whole.groupId);

    const folded = deriveTranscriptRows(
      updates.slice(1),
      new Map([[whole.groupId, false]]),
      null,
      null,
      false,
    )[0];
    if (folded.kind !== "activity") throw new Error("expected an activity group");
    expect(folded.open).toBe(false);
  });

  it("stops a group pulsing once the session is no longer working", () => {
    // A call left in progress by a killed session rests in the transcript as
    // history. Reading it as activity made every group pulse forever after a
    // daemon restart.
    const updates: SessionUpdate[] = [
      {
        kind: "tool_call",
        status: "in_progress",
        title: "Run tests",
        tool_call_id: "p",
        tool_kind: "execute",
      },
      {
        kind: "tool_call",
        status: "completed",
        title: "Run lint",
        tool_call_id: "q",
        tool_kind: "execute",
      },
    ];

    const settled = deriveTranscriptRows(updates, new Map(), null, null, false, "perm-stale")[0];
    if (settled.kind !== "activity") throw new Error("expected an activity group");
    expect(settled.live).toBe(false);
    expect(settled.open).toBe(false);
    expect(settled.summary.text.startsWith("Ran")).toBe(true);

    const running = deriveTranscriptRows(updates, new Map(), null, null, true)[0];
    if (running.kind !== "activity") throw new Error("expected an activity group");
    expect(running.live).toBe(true);
    expect(running.open).toBe(true);
  });

  it("opens a failed group by default but lets the reader fold it away", () => {
    const updates: SessionUpdate[] = [
      {
        kind: "tool_call",
        status: "completed",
        title: "Run ls",
        tool_call_id: "ok",
        tool_kind: "execute",
      },
      {
        kind: "tool_call",
        status: "failed",
        title: "Run rg",
        tool_call_id: "bad",
        tool_kind: "execute",
      },
    ];

    const rows = deriveTranscriptRows(updates, new Map(), null, null, true);
    const group = rows[0];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.hasFailure).toBe(true);
    expect(group.open).toBe(true);

    // A non-zero exit is not a blocker: unlike an unanswered prompt, the reader
    // may fold it away and the choice sticks.
    const folded = deriveTranscriptRows(updates, new Map([[group.groupId, false]]), null, null, true);
    const foldedGroup = folded[0];
    if (foldedGroup.kind !== "activity") throw new Error("expected an activity group");
    expect(foldedGroup.open).toBe(false);
  });

  it("does not force open a permission left behind by a finished session", () => {
    // The daemon restart left permission requests that can never be answered.
    // They are history: the reader's fold has to stick, or a handful of old
    // groups in a long transcript become impossible to close.
    const updates: SessionUpdate[] = [
      {
        kind: "tool_call",
        pendingPermission: { options: ["allow", "deny"], request_id: "perm-stale" },
        status: "pending",
        title: "Run rm",
        tool_call_id: "stale",
        tool_kind: "execute",
      },
      {
        kind: "tool_call",
        status: "completed",
        title: "Run ls",
        tool_call_id: "done",
        tool_kind: "execute",
      },
    ];

    const settled = deriveTranscriptRows(updates, new Map(), null, null, false, "perm-stale")[0];
    if (settled.kind !== "activity") throw new Error("expected an activity group");
    expect(settled.hasPendingApproval).toBe(true);
    expect(settled.open).toBe(false);

    const folded = deriveTranscriptRows(
      updates,
      new Map([[settled.groupId, false]]),
      null,
      null,
      false,
      "perm-stale",
    )[0];
    if (folded.kind !== "activity") throw new Error("expected an activity group");
    expect(folded.open).toBe(false);
  });

  it("only the session's current request holds a group open", () => {
    // Abandoned requests leave their flag on the call: the flags outnumber the
    // live requests, so a group whose flag is stale must stay foldable while
    // the group that owns the current request is forced open.
    const stale: SessionUpdate[] = [
      {
        kind: "tool_call",
        pendingPermission: { options: ["allow", "deny"], request_id: "old-1" },
        status: "pending",
        title: "Run old",
        tool_call_id: "old",
        tool_kind: "execute",
      },
      {
        kind: "tool_call",
        status: "completed",
        title: "Run ls",
        tool_call_id: "ls",
        tool_kind: "execute",
      },
    ];
    const current: SessionUpdate[] = [
      {
        kind: "tool_call",
        pendingPermission: { options: ["allow", "deny"], request_id: "now-1" },
        status: "pending",
        title: "Run now",
        tool_call_id: "now",
        tool_kind: "execute",
      },
      {
        kind: "tool_call",
        status: "completed",
        title: "Run ls",
        tool_call_id: "ls2",
        tool_kind: "execute",
      },
    ];

    const staleRow = deriveTranscriptRows(stale, new Map(), null, null, true, "now-1")[0];
    if (staleRow.kind !== "activity") throw new Error("expected an activity group");
    expect(staleRow.hasPendingApproval).toBe(false);
    expect(staleRow.open).toBe(true); // live group opens by default — but folds:
    const folded = deriveTranscriptRows(
      stale,
      new Map([[staleRow.groupId, false]]),
      null,
      null,
      true,
      "now-1",
    )[0];
    if (folded.kind !== "activity") throw new Error("expected an activity group");
    expect(folded.open).toBe(false);

    const currentRow = deriveTranscriptRows(current, new Map(), null, null, true, "now-1")[0];
    if (currentRow.kind !== "activity") throw new Error("expected an activity group");
    expect(currentRow.hasPendingApproval).toBe(true);
    expect(currentRow.open).toBe(true);
  });

  it("forces a group open while a permission is unanswered, override or not", () => {
    const updates: SessionUpdate[] = [
      {
        kind: "tool_call",
        pendingPermission: { options: ["allow", "deny"], request_id: "perm-1" },
        status: "pending",
        title: "Run rm",
        tool_call_id: "blocked",
        tool_kind: "execute",
      },
      {
        kind: "tool_call",
        status: "completed",
        title: "Run ls",
        tool_call_id: "done",
        tool_kind: "execute",
      },
    ];

    const rows = deriveTranscriptRows(updates, new Map(), null, null, true, "perm-1");
    const group = rows[0];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.hasPendingApproval).toBe(true);
    expect(group.open).toBe(true);

    const folded = deriveTranscriptRows(
      updates,
      new Map([[group.groupId, false]]),
      null,
      null,
      true,
      "perm-1",
    );
    const foldedGroup = folded[0];
    if (foldedGroup.kind !== "activity") throw new Error("expected an activity group");
    expect(foldedGroup.open).toBe(true);
  });

  it("keeps an active thinking group live and open by default", () => {
    const updates: SessionUpdate[] = [
      { kind: "agent_thought", text: "Looking" },
      {
        kind: "tool_call",
        tool_call_id: "read-1",
        title: "Read file",
        status: "completed",
        tool_kind: "read",
      },
    ];
    const first = deriveTranscriptRows(updates, new Map(), 0, null, true);
    const repeated = deriveTranscriptRows(updates, new Map(), 0, null, true);

    expect(first.map((row) => row.kind)).toEqual(["activity"]);
    const group = first[0];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.live).toBe(true);
    expect(group.open).toBe(true);
    expect(transcriptRowsAreEqual(first[0], repeated[0])).toBe(true);
  });

  it("anchors a group that folds itself when a live turn settles", () => {
    const live: SessionUpdate[] = [
      {
        kind: "tool_call",
        tool_call_id: "r1",
        title: "Read file 'src/a.ts'",
        status: "completed",
        tool_kind: "read",
      },
      {
        kind: "tool_call",
        tool_call_id: "x1",
        title: "npm test",
        status: "in_progress",
        tool_kind: "execute",
      },
    ];
    const liveRows = deriveTranscriptRows(live, new Map(), null, null, true);
    const liveRow = liveRows[0];
    if (liveRow.kind !== "activity") throw new Error("expected an activity group");
    expect(liveRow.expandable).toBe(true);
    expect(liveRow.open).toBe(true);

    const settled: SessionUpdate[] = [
      { ...live[0] },
      {
        kind: "tool_call",
        tool_call_id: "x1",
        title: "npm test",
        status: "completed",
        tool_kind: "execute",
      },
    ];
    const settledRows = deriveTranscriptRows(settled, new Map(), null, null, true);
    const settledRow = settledRows[0];
    if (settledRow.kind !== "activity") throw new Error("expected an activity group");
    expect(settledRow.open).toBe(false);

    // Same shape the manual toggle uses: `activity:${groupId}` = row.id.
    expect(automaticFoldAnchor(activityOpenState(liveRows), settledRows, new Map())).toBe(
      settledRow.id,
    );
    expect(settledRow.id).toBe(`activity:${liveRow.groupId}`);
  });

  it("leaves a user-folded group's anchor to the manual toggle", () => {
    const live: SessionUpdate[] = [
      {
        kind: "tool_call",
        tool_call_id: "r1",
        title: "Read file 'src/a.ts'",
        status: "completed",
        tool_kind: "read",
      },
      {
        kind: "tool_call",
        tool_call_id: "x1",
        title: "npm test",
        status: "in_progress",
        tool_kind: "execute",
      },
    ];
    const liveRows = deriveTranscriptRows(live, new Map(), null, null, true);
    const liveRow = liveRows[0];
    if (liveRow.kind !== "activity") throw new Error("expected an activity group");
    const foldedRows = deriveTranscriptRows(live, new Map([[liveRow.groupId, false]]), null, null, true);

    expect(
      automaticFoldAnchor(
        activityOpenState(liveRows),
        foldedRows,
        new Map([[liveRow.groupId, false]]),
      ),
    ).toBeNull();
  });

  it("folds a re-emitted permission request onto the first so row keys stay unique", () => {
    const request: SessionUpdate = {
      kind: "permission_request",
      request_id: "req-1",
      title: "Run the command",
      options: ["allow", "deny"],
    };
    const updates: SessionUpdate[] = [
      { kind: "user_message", text: "Go" },
      request,
      { kind: "agent_text", text: "Waiting" },
      request,
    ];

    const rows = deriveTranscriptRows(coalesceUpdates(updates), new Map(), null, null, true);
    const ids = rows.map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(appendCoalescedUpdate([request], request)).toEqual([request]);
  });

  it("asks for permission on the gated tool's own row, not beside it", () => {
    const call: SessionUpdate = {
      kind: "tool_call",
      tool_call_id: "exec-1",
      title: "git commit",
      status: "pending",
      tool_kind: "execute",
    };
    const request: SessionUpdate = {
      kind: "permission_request",
      request_id: "req-1",
      title: "Bash",
      options: ["allow", "deny"],
      tool_call_id: "exec-1",
    };

    const folded = coalesceUpdates([call, request]);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({
      kind: "tool_call",
      pendingPermission: { request_id: "req-1", options: ["allow", "deny"] },
    });

    // Same result when the request arrives live rather than in a history.
    const live = appendCoalescedUpdate([call], request);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ pendingPermission: { request_id: "req-1" } });
  });

  it("keeps a row of its own when no tool call is named", () => {
    const call: SessionUpdate = {
      kind: "tool_call",
      tool_call_id: "exec-1",
      title: "git commit",
      status: "pending",
      tool_kind: "execute",
    };
    // An older history, recorded before the daemon carried the id through.
    const request: SessionUpdate = {
      kind: "permission_request",
      request_id: "req-1",
      title: "Bash",
      options: ["allow", "deny"],
    };

    expect(coalesceUpdates([call, request])).toHaveLength(2);
  });
});

describe("session history merge", () => {
  const tool = (status: "pending" | "completed"): SessionUpdate => ({
    kind: "tool_call",
    tool_call_id: "read-1",
    title: "Read file",
    status,
    tool_kind: "read",
  });

  it("does not stack a live copy that the fetch already folded differently", () => {
    const fetched: SessionUpdate[] = [
      { kind: "user_message", text: "Go" },
      tool("completed"),
      { kind: "agent_text", text: "Done" },
    ];
    // Live updates fold from a raw stream, so a tool call whose opening frames
    // arrive during the fetch lands in a different position than in the fetch.
    const live: SessionUpdate[] = [tool("completed"), { kind: "agent_text", text: "Done" }];

    expect(mergeSessionHistory(fetched, live)).toEqual(fetched);
  });

  it("keeps updates that arrived while the fetch was in flight", () => {
    const fetched: SessionUpdate[] = [
      { kind: "user_message", text: "Go" },
      { kind: "agent_text", text: "Done" },
    ];
    const live: SessionUpdate[] = [
      { kind: "agent_text", text: "Done" },
      { kind: "user_message", text: "And again" },
    ];

    expect(mergeSessionHistory(fetched, live)).toEqual([
      ...fetched,
      { kind: "user_message", text: "And again" },
    ]);
  });

  it("keeps the live copy whole when nothing was persisted yet", () => {
    const live: SessionUpdate[] = [{ kind: "user_message", text: "Go" }];

    expect(mergeSessionHistory([], live)).toEqual(live);
  });
});
