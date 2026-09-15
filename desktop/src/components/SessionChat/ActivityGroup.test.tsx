import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { deriveTranscriptRows, type TranscriptListRow } from "@/lib/sessionStream";

import type { SessionUpdate } from "../../protocol";
import { ActivityGroup } from "./ActivityGroup";
import { TranscriptRowContext } from "./TranscriptRow";

type ActivityRow = Extract<TranscriptListRow, { kind: "activity" }>;

const updates: SessionUpdate[] = [
  {
    kind: "tool_call",
    tool_call_id: "r1",
    title: "Read file '/Users/dev/app/src/a.ts'",
    status: "completed",
    tool_kind: "read",
  },
  {
    kind: "file_edit",
    path: "/Users/dev/app/src/b.ts",
    tool_call_id: "e1",
    additions: 12,
    deletions: 3,
  },
  {
    kind: "tool_call",
    tool_call_id: "x1",
    title: "npm test",
    status: "completed",
    tool_kind: "execute",
    content: "1 test passed",
  },
];

function activityRow(source: SessionUpdate[], overrides = new Map<string, boolean>()): ActivityRow {
  const row = deriveTranscriptRows(source, overrides, null, null).find(
    (candidate) => candidate.kind === "activity",
  );
  if (!row || row.kind !== "activity") throw new Error("expected an activity row");
  return row;
}

function renderGroup(
  row: ActivityRow,
  handlers: { onOpenFile?: (path: string) => void; onOpenFileDiff?: (path: string) => void } = {},
) {
  const onToggleWorkGroup = vi.fn<(id: string, open: boolean) => void>();
  const result = render(
    <TranscriptRowContext.Provider
      value={{
        agents: [],
        onOpenFile: handlers.onOpenFile ?? vi.fn<(path: string) => void>(),
        onOpenFileDiff: handlers.onOpenFileDiff ?? vi.fn<(path: string) => void>(),
        onOpenTask: vi.fn<(id: string) => void>(),
        onRequestBranch: vi.fn<(agent: string, index: number) => void>(),
        onToggleWorkGroup,
        project: "app",
        resolveFilePath: (value) =>
          value.includes("/Users/") ? value.slice(value.indexOf("/src/") + 1) : value,
        resolved: {},
        taskId: "task-1",
      }}
    >
      <ActivityGroup row={row} />
    </TranscriptRowContext.Provider>,
  );
  return { ...result, onToggleWorkGroup };
}

function renderExpanded(handlers = {}) {
  return renderGroup(activityRow(updates, new Map([["work:tool:r1", true]])), handlers);
}

describe("ActivityGroup", () => {
  it("collapses a settled group behind one summary line with no status words", () => {
    renderGroup(activityRow(updates));

    const header = screen.getByRole("button", { name: /show the work/i });
    expect(header).toHaveAttribute("aria-expanded", "false");
    const headerText = header.closest("div")?.textContent ?? "";
    expect(headerText).toContain("Read a.ts");
    expect(headerText).toContain("Edited b.ts");
    expect(headerText).toContain("Ran a command");
    expect(screen.queryByText(/completed/i)).not.toBeInTheDocument();
  });

  it("opens on click and reports the desired state", async () => {
    const { onToggleWorkGroup } = renderGroup(activityRow(updates));

    await userEvent.click(screen.getByRole("button", { name: /show the work/i }));

    expect(onToggleWorkGroup).toHaveBeenCalledTimes(1);
    const [groupId, open] = onToggleWorkGroup.mock.calls[0];
    expect(groupId).toBe("work:tool:r1");
    expect(open).toBe(true);
  });

  it("renders steps on the rail only when open, as 24px borderless lines", () => {
    const { container } = renderExpanded();

    expect(container.querySelector(".activity-rail")).not.toBeNull();
    expect(container.querySelectorAll(".activity-rail-step")).toHaveLength(updates.length);
    const line = screen.getByText("npm test").closest("div");
    expect(line?.className).toContain("py-1");
    expect(line?.className).toContain("text-[13px]");
    expect(line?.className).toContain("leading-5");
    expect(container.querySelector(".activity-rail-step")?.className).not.toContain("border");
  });

  it("shows the basename with the repo-relative path in the title, never the absolute path", () => {
    const { container } = renderExpanded();

    expect(screen.getByTitle("src/a.ts")).toHaveTextContent("a.ts");
    expect(container.textContent).not.toContain("/Users/");
    expect(container.querySelector('[title*="/Users/"]')).toBeNull();
  });

  it("offers a clickable diffstat on the edit step", async () => {
    const onOpenFileDiff = vi.fn<(path: string) => void>();
    renderExpanded({ onOpenFileDiff });

    const diffstats = screen.getAllByRole("button", {
      name: /12 lines added, 3 lines deleted/i,
    });
    expect(diffstats[0]).toHaveTextContent("+12");
    expect(diffstats[0]).toHaveTextContent("−3");
    await userEvent.click(diffstats[diffstats.length - 1]);
    expect(onOpenFileDiff).toHaveBeenCalledWith("src/b.ts", undefined);
  });

  it("marks a failed group and keeps it open", () => {
    const failed: SessionUpdate[] = [
      {
        kind: "tool_call",
        tool_call_id: "r1",
        title: "Read file 'src/a.ts'",
        status: "completed",
        tool_kind: "read",
      },
      {
        kind: "tool_call",
        tool_call_id: "r2",
        title: "Read file 'src/missing.ts'",
        status: "failed",
        tool_kind: "read",
      },
    ];
    const row = activityRow(failed);
    renderGroup(row);

    expect(screen.getByRole("button", { name: /hide the work/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it("toggles a step's output from its label, not just the chevron", async () => {
    renderExpanded();

    const label = screen.getByText("npm test");
    expect(screen.queryByText("1 test passed")).not.toBeInTheDocument();

    await userEvent.click(label);
    expect(screen.getByText("1 test passed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide output for npm test/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await userEvent.click(label);
    expect(screen.queryByText("1 test passed")).not.toBeInTheDocument();
  });

  it("keeps the step chevron visible without hover", () => {
    renderExpanded();

    const row = screen.getByText("npm test").closest("div.group");
    const chevron = row?.querySelector(".lucide-chevron-right");
    expect(chevron?.getAttribute("class")).toContain("opacity-60");
    expect(row?.className).toContain("hover:bg-accent/40");
    expect(row?.className).toContain("cursor-pointer");
  });

  it("leaves a step with nothing to reveal inert", () => {
    const source: SessionUpdate[] = [
      {
        kind: "tool_call",
        tool_call_id: "t1",
        title: "Use tool",
        status: "completed",
        tool_kind: "other",
      },
      {
        kind: "tool_call",
        tool_call_id: "x1",
        title: "npm test",
        status: "completed",
        tool_kind: "execute",
        content: "1 test passed",
      },
    ];
    renderGroup(activityRow(source, new Map([["work:tool:t1", true]])));

    const row = screen.getByText("Use tool").closest("div");
    expect(row?.className).not.toContain("hover:bg-accent");
    expect(row?.className).not.toContain("cursor-pointer");
    expect(row?.querySelector(".lucide-chevron-right")).toBeNull();
    expect(screen.queryByRole("button", { name: /output for Use tool/i })).not.toBeInTheDocument();
  });

  it("clicks a step chip without toggling the step", async () => {
    const onOpenFile = vi.fn<(path: string) => void>();
    renderExpanded({ onOpenFile });

    await userEvent.click(screen.getByTitle("src/a.ts"));

    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
    expect(screen.queryByText("1 test passed")).not.toBeInTheDocument();
  });

  it("keeps a lone step's icon inside the hover and hit area", () => {
    const single: SessionUpdate[] = [
      {
        kind: "tool_call",
        tool_call_id: "x1",
        title: "npm test",
        status: "completed",
        tool_kind: "execute",
        content: "1 test passed",
      },
    ];
    renderGroup(activityRow(single));

    const toggle = screen.getByRole("button", { name: /show output for npm test/i });
    const row = toggle.parentElement;
    expect(row?.className).toContain("hover:bg-accent/40");
    expect(row?.querySelector("svg.lucide-terminal")).not.toBeNull();
  });

  it("renders thinking inside a step without a second accordion", async () => {
    const source: SessionUpdate[] = [
      {
        kind: "tool_call",
        tool_call_id: "r1",
        title: "Read file 'src/a.ts'",
        status: "completed",
        tool_kind: "read",
      },
      { kind: "agent_thought", text: "Reasoning step\nwith more text" },
    ];
    const row = activityRow(source, new Map([["work:tool:r1", true]]));
    renderGroup(row);

    await userEvent.click(screen.getByText("Reasoning step"));

    expect(screen.getByText(/with more text/)).toBeInTheDocument();
    expect(screen.getByLabelText("Agent thinking")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^thinking/i })).not.toBeInTheDocument();
  });

  it("windows a long live group to its newest steps", () => {
    const source: SessionUpdate[] = Array.from({ length: 199 }, (_, index) =>
      readStep(`r${index}`),
    ).concat([
      {
        kind: "tool_call",
        tool_call_id: "live",
        title: "npm test",
        status: "in_progress",
        tool_kind: "execute",
      },
    ]);
    renderGroup(activityRow(source));

    const earlier = screen.getByText("50 earlier steps");
    expect(earlier.className).toContain("px-2");
    expect(earlier.parentElement?.className).toContain("activity-rail-step");
    expect(document.querySelectorAll(".activity-rail-step")).toHaveLength(151);
  });

  it("keeps an 8px gutter inside the header band and an expanded step body", async () => {
    renderExpanded();

    const headerBand = screen.getByRole("button", { name: /hide the work/i }).parentElement;
    expect(headerBand?.className).toContain("px-2");

    const stepBand = screen.getByText("npm test").closest("div.group");
    expect(stepBand?.className).toContain("px-2");

    await userEvent.click(screen.getByText("npm test"));
    expect(screen.getByText("1 test passed").className).toContain("px-2");
  });

  it("indents a standalone step and its body by the same gutter", async () => {
    const single: SessionUpdate[] = [
      {
        kind: "agent_thought",
        text: "Reasoning step\nwith more text",
      },
    ];
    renderGroup(activityRow(single));

    const band = screen.getByRole("button", { name: /show thinking/i }).parentElement;
    expect(band?.className).toContain("px-2");

    await userEvent.click(screen.getByText("Reasoning step"));

    const body = screen.getByLabelText("Agent thinking").parentElement;
    expect(body?.className).toContain("px-2");
    expect(body?.className).not.toContain("pl-5");
  });
});

function readStep(id: string): SessionUpdate {
  return {
    kind: "tool_call",
    tool_call_id: id,
    title: `Read file 'src/${id}.ts'`,
    status: "completed",
    tool_kind: "read",
  };
}
