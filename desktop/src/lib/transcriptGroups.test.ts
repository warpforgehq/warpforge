import { describe, expect, it } from "vitest";

import type { SessionUpdate, ToolCallStatus } from "../protocol";
import { coalesceUpdates, deriveTranscriptRows, transcriptRowsAreEqual } from "./sessionStream";
import { summarizeActivity, tallyActivity } from "./transcriptGroups";

const read = (id: string, path: string, status: ToolCallStatus = "completed"): SessionUpdate => ({
  kind: "tool_call",
  tool_call_id: id,
  title: `Read file '${path}'`,
  status,
  tool_kind: "read",
});

const search = (id: string): SessionUpdate => ({
  kind: "tool_call",
  tool_call_id: id,
  title: "Search workspace",
  status: "completed",
  tool_kind: "search",
});

const execute = (id: string, status: ToolCallStatus = "completed"): SessionUpdate => ({
  kind: "tool_call",
  tool_call_id: id,
  title: "git status",
  status,
  tool_kind: "execute",
});

const editCall = (
  id: string,
  path: string,
  status: ToolCallStatus = "completed",
): SessionUpdate => ({
  kind: "tool_call",
  tool_call_id: id,
  title: `Edit file '${path}'`,
  status,
  tool_kind: "edit",
});

const fileEdit = (
  id: string,
  path: string,
  additions?: number,
  deletions?: number,
): SessionUpdate => ({
  kind: "file_edit",
  path,
  tool_call_id: id,
  additions,
  deletions,
});

const thought = (text: string): SessionUpdate => ({ kind: "agent_thought", text });
const prose = (text: string): SessionUpdate => ({ kind: "agent_text", text });

function activityRows(updates: SessionUpdate[], overrides = new Map<string, boolean>()) {
  return deriveTranscriptRows(coalesceUpdates(updates), overrides, null, null).filter(
    (row) => row.kind === "activity",
  );
}

describe("transcript work grouping", () => {
  it("leaves a single read between prose as a standalone step", () => {
    const rows = deriveTranscriptRows(
      coalesceUpdates([prose("before"), read("r1", "src/a.ts"), prose("after")]),
      new Map(),
      null,
      null,
    );

    expect(rows.map((row) => row.kind)).toEqual(["update", "activity", "update"]);
    const group = rows[1];
    if (group.kind !== "activity") throw new Error("expected an activity group");
    expect(group.expandable).toBe(false);
    expect(group.items).toHaveLength(1);
  });

  it("summarises one file by basename and many by count", () => {
    const same = activityRows([
      read("r1", "src/a.ts"),
      read("r2", "src/a.ts"),
      read("r3", "src/a.ts"),
    ]);
    expect(same[0].summary.text).toBe("Read a.ts");

    const many = activityRows(
      Array.from({ length: 8 }, (_, index) => read(`r${index}`, `src/f${index}.ts`)),
    );
    expect(many[0].summary.text).toBe("Read 8 files");
  });

  it("keeps mixed clauses in first-seen order with a summed diffstat", () => {
    const rows = activityRows([
      read("r1", "src/a.ts"),
      search("s1"),
      fileEdit("e1", "src/c.ts", 10, 2),
      read("r2", "src/b.ts"),
      execute("x1"),
      fileEdit("e2", "src/d.ts", 8, 4),
    ]);
    const group = rows[0];
    expect(group.summary.text).toBe(
      "Read 2 files · Searched the project · Edited 2 files · Ran a command",
    );
    const edit = group.summary.clips.find((clip) => clip.kind === "edit");
    expect(edit).toMatchObject({ additions: 18, deletions: 6 });
  });

  it("leaves the diffstat out when no edit reported line counts", () => {
    const rows = activityRows([editCall("e1", "src/a.ts"), fileEdit("e1", "src/a.ts")]);
    const tally = tallyActivity(rows[0].items);
    expect(tally.additions).toBeNull();
    expect(tally.deletions).toBeNull();
    const edit = rows[0].summary.clips.find((clip) => clip.kind === "edit");
    expect(edit).toMatchObject({ additions: undefined, deletions: undefined });
    expect(rows[0].summary.text).toBe("Edited a.ts");
  });

  it("sums the counts it has when only some edits report them", () => {
    const rows = activityRows([fileEdit("e1", "src/a.ts"), fileEdit("e2", "src/b.ts", 4, 1)]);
    const edit = rows[0].summary.clips.find((clip) => clip.kind === "edit");
    expect(edit).toMatchObject({ files: 2, additions: 4, deletions: 1 });
  });

  it("keeps an in-flight call live with present tense and open by default", () => {
    const rows = activityRows([read("r1", "src/a.ts"), read("r2", "src/b.ts", "in_progress")]);
    expect(rows[0].live).toBe(true);
    expect(rows[0].open).toBe(true);
    expect(rows[0].summary.text).toBe("Reading 2 files");
  });

  it("opens a failed group and appends the failure count", () => {
    const rows = activityRows([
      read("r1", "src/a.ts", "completed"),
      read("r2", "src/b.ts", "failed"),
    ]);
    expect(rows[0].hasFailure).toBe(true);
    expect(rows[0].open).toBe(true);
    expect(rows[0].summary.text).toBe("Read 2 files · 1 failed");
  });

  it("forces a pending approval open even over an explicit collapse", () => {
    const pending: SessionUpdate = {
      kind: "tool_call",
      tool_call_id: "x1",
      title: "git push",
      status: "pending",
      tool_kind: "execute",
      pendingPermission: { request_id: "req-1", options: ["allow", "deny"] },
    };
    const rows = activityRows(
      [read("r1", "src/a.ts"), pending],
      new Map([["work:tool:r1", false]]),
    );
    expect(rows[0].hasPendingApproval).toBe(true);
    expect(rows[0].open).toBe(true);
  });

  it("counts an edit once when its tool call and file_edit share an id", () => {
    const rows = activityRows([editCall("e1", "src/a.ts"), fileEdit("e1", "src/a.ts", 5, 1)]);
    const tally = tallyActivity(rows[0].items);
    expect(tally.edits.size).toBe(1);
    expect(tally.additions).toBe(5);
    expect(tally.deletions).toBe(1);
    expect(rows[0].summary.text).toBe("Edited a.ts");
  });

  it("treats plan as standalone so it breaks a group and never folds", () => {
    const rows = deriveTranscriptRows(
      coalesceUpdates([
        read("r1", "src/a.ts"),
        { kind: "plan", entries: [] },
        read("r2", "src/b.ts"),
      ]),
      new Map(),
      null,
      null,
    );
    expect(rows.map((row) => row.kind)).toEqual(["activity", "update", "activity"]);
    expect(rows[1].kind === "update" && rows[1].entry.update.kind).toBe("plan");
  });

  it("keeps the group id and row key stable as items arrive", () => {
    const two = activityRows([read("r1", "src/a.ts"), read("r2", "src/b.ts")]);
    const three = activityRows([
      read("r1", "src/a.ts"),
      read("r2", "src/b.ts"),
      read("r3", "src/c.ts"),
    ]);
    expect(three[0].id).toBe(two[0].id);
    expect(three[0].groupId).toBe(two[0].groupId);
    expect(three[0].items).toHaveLength(3);
  });

  it("honours a manual collapse while the group is still live", () => {
    const updates = [read("r1", "src/a.ts"), read("r2", "src/b.ts", "in_progress")];
    const groupId = activityRows(updates)[0].groupId;
    const collapsed = activityRows(updates, new Map([[groupId, false]]));
    expect(collapsed[0].live).toBe(true);
    expect(collapsed[0].open).toBe(false);
  });

  it("never folds prose, user messages or command results", () => {
    const updates: SessionUpdate[] = [
      { kind: "user_message", text: "go" },
      read("r1", "src/a.ts"),
      read("r2", "src/b.ts"),
      prose("done"),
      { kind: "workflow_event", event: "stage_started", title: "Review", agents: [], tone: "info" },
    ];
    const rows = deriveTranscriptRows(coalesceUpdates(updates), new Map(), null, null);
    expect(rows.map((row) => row.kind)).toEqual(["update", "activity", "update", "update"]);
  });

  it("compares stable activity rows cheaply, re-rendering on summary or open changes", () => {
    const first = activityRows([read("r1", "src/a.ts"), read("r2", "src/b.ts")])[0];
    const same = activityRows([read("r1", "src/a.ts"), read("r2", "src/b.ts")])[0];
    const more = activityRows([
      read("r1", "src/a.ts"),
      read("r2", "src/b.ts"),
      read("r3", "src/c.ts"),
    ])[0];
    const opened = deriveTranscriptRows(
      coalesceUpdates([read("r1", "src/a.ts"), read("r2", "src/b.ts")]),
      new Map([[first.groupId, true]]),
      null,
      null,
    ).find((row) => row.kind === "activity")!;
    if (opened.kind !== "activity") throw new Error("expected a group");

    expect(transcriptRowsAreEqual(first, same)).toBe(true);
    expect(transcriptRowsAreEqual(first, more)).toBe(false);
    expect(transcriptRowsAreEqual(first, opened)).toBe(false);
  });
});

describe("transcript tally", () => {
  it("counts a search-only group as exploring, not reading", () => {
    const rows = activityRows([search("s1"), search("s2")]);
    expect(rows[0].summary.text).toBe("Searched the project");
  });

  it("counts tool kinds that only exist in the title", () => {
    const updates: SessionUpdate[] = [
      {
        kind: "tool_call",
        tool_call_id: "x",
        title: "Read file '/repo/src/a.ts'",
        status: "completed",
        tool_kind: "other",
      },
      {
        kind: "tool_call",
        tool_call_id: "y",
        title: "Run npm test",
        status: "completed",
        tool_kind: "other",
      },
    ];
    const rows = activityRows(updates);
    expect(rows[0].summary.text).toBe("Read a.ts · Ran a command");
  });

  it("summarises a thought-only live group as thinking", () => {
    const summary = summarizeActivity(
      [
        {
          key: "i:0",
          category: "think",
          entry: { mergedIndex: 0, update: thought("weighing options") },
        },
      ],
      true,
    );
    expect(summary.text).toBe("Thinking");
  });
});
