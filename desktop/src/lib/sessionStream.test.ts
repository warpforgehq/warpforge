import { describe, expect, it } from "vitest";

import type { SessionUpdate } from "../protocol";
import {
  appendCoalescedUpdate,
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

    const rows = deriveTranscriptRows(updates, new Map(), null, null);

    expect(rows.map((row) => row.kind)).toEqual(["update", "activity", "update"]);
    const group = rows[1];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.items).toHaveLength(2);
    expect(group.expandable).toBe(true);
    expect(group.open).toBe(false);
    expect(group.summary.text).toBe("Read a.ts");

    const expanded = deriveTranscriptRows(updates, new Map([[group.groupId, true]]), null, null);
    const reopened = expanded[1];
    if (reopened.kind !== "activity") throw new Error("expected an activity group");
    expect(reopened.open).toBe(true);
    expect(reopened.id).toBe(group.id);
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

    const rows = deriveTranscriptRows(updates, new Map(), null, null);
    const group = rows[0];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.hasFailure).toBe(true);
    expect(group.open).toBe(true);

    // A non-zero exit is not a blocker: unlike an unanswered prompt, the reader
    // may fold it away and the choice sticks.
    const folded = deriveTranscriptRows(updates, new Map([[group.groupId, false]]), null, null);
    const foldedGroup = folded[0];
    if (foldedGroup.kind !== "activity") throw new Error("expected an activity group");
    expect(foldedGroup.open).toBe(false);
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

    const rows = deriveTranscriptRows(updates, new Map(), null, null);
    const group = rows[0];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.hasPendingApproval).toBe(true);
    expect(group.open).toBe(true);

    const folded = deriveTranscriptRows(updates, new Map([[group.groupId, false]]), null, null);
    const foldedGroup = folded[0];
    if (foldedGroup.kind !== "activity") throw new Error("expected an activity group");
    expect(foldedGroup.open).toBe(true);
  });

  it("keeps an active thinking group live and open by default", () => {    const updates: SessionUpdate[] = [
      { kind: "agent_thought", text: "Looking" },
      {
        kind: "tool_call",
        tool_call_id: "read-1",
        title: "Read file",
        status: "completed",
        tool_kind: "read",
      },
    ];
    const first = deriveTranscriptRows(updates, new Map(), 0, null);
    const repeated = deriveTranscriptRows(updates, new Map(), 0, null);

    expect(first.map((row) => row.kind)).toEqual(["activity"]);
    const group = first[0];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.live).toBe(true);
    expect(group.open).toBe(true);
    expect(transcriptRowsAreEqual(first[0], repeated[0])).toBe(true);
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

    const rows = deriveTranscriptRows(coalesceUpdates(updates), new Map(), null, null);
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
