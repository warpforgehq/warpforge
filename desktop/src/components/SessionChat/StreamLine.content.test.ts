import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { EditHunk } from "@/protocol";

import { StreamLine } from "./StreamLine";

describe("file edit line", () => {
  it("shows a project-relative path and per-edit line counts", () => {
    render(
      createElement(StreamLine, {
        update: {
          kind: "file_edit",
          path: "/Users/dev/warpforge/desktop/src/App.tsx",
          additions: 12,
          deletions: 3,
        },
        project: "warpforge",
        resolveFilePath: () => "desktop/src/App.tsx",
      }),
    );

    expect(screen.getByText("warpforge/desktop/src/App.tsx")).toBeInTheDocument();
    expect(screen.queryByText("/Users/dev/warpforge/desktop/src/App.tsx")).not.toBeInTheDocument();
    expect(screen.getByLabelText("12 lines added, 3 lines deleted")).toBeInTheDocument();
  });

  it("opens the editor from the file name and the exact diff from the line counts", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn<(path: string) => void>();
    const onOpenFileDiff = vi.fn<(path: string, hunks?: EditHunk[]) => void>();
    const editHunks = [
      {
        lines: ["-old", "+new"],
        newLines: 1,
        newStart: 12,
        oldLines: 1,
        oldStart: 12,
      },
    ];
    render(
      createElement(StreamLine, {
        update: {
          kind: "file_edit",
          path: "desktop/src/App.tsx",
          additions: 6,
          deletions: 2,
          hunks: editHunks,
        },
        resolveFilePath: () => "desktop/src/App.tsx",
        onOpenFile,
        onOpenFileDiff,
      }),
    );

    await user.click(screen.getByRole("button", { name: "desktop/src/App.tsx" }));
    expect(onOpenFile).toHaveBeenCalledWith("desktop/src/App.tsx");
    expect(onOpenFileDiff).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: "Open diff for desktop/src/App.tsx: 6 lines added, 2 lines deleted",
      }),
    );
    expect(onOpenFileDiff).toHaveBeenCalledWith("desktop/src/App.tsx", editHunks);
  });
});

describe("agent text streaming", () => {
  it("polls only the active streaming message, not historical transcript rows", () => {
    const interval = vi.spyOn(window, "setInterval");
    const historical = render(
      createElement(StreamLine, {
        update: { kind: "agent_text", text: "Finished response" },
      }),
    );
    expect(interval).not.toHaveBeenCalled();
    historical.unmount();

    render(
      createElement(StreamLine, {
        textStreaming: true,
        update: { kind: "agent_text", text: "Streaming response" },
      }),
    );
    expect(interval).toHaveBeenCalledTimes(1);
  });
});

describe("workflow conversation events", () => {
  it("renders a persistent inline agent card and opens its child session", async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn<(id: string) => void>();
    render(
      createElement(StreamLine, {
        onOpenTask,
        update: {
          agents: [
            {
              agent: "codex",
              label: "implement",
              model: "gpt-5.6-sol",
              taskId: "t_impl",
            },
          ],
          event: "stage_started",
          kind: "workflow_event",
          stage: "implement",
          title: "Implement started",
          tone: "running",
        },
      }),
    );

    expect(screen.getByText("Implement started")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.6-sol")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open implement agent session" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_impl");
  });

  it("renders an agent summary as the next independent history entry", () => {
    render(
      createElement(StreamLine, {
        update: {
          agents: [
            {
              agent: "codex",
              label: "implement",
              taskId: "t_impl",
            },
          ],
          detail: "Implemented the parser and ran **all tests**.",
          event: "agent_output",
          kind: "workflow_event",
          stage: "implement",
          title: "Implement completed",
          tone: "success",
        },
      }),
    );

    expect(screen.getByText("Implement completed")).toBeInTheDocument();
    expect(screen.getByText(/Implemented the parser/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open implement agent session" }),
    ).toBeInTheDocument();
  });
});
