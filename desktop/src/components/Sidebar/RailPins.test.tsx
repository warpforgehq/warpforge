import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { DaemonState } from "@/daemon";
import { EMPTY_SNAPSHOT, type TaskInfo } from "@/protocol";
import { usePins } from "@/store/pins";
import { useUi } from "@/store/ui";

import { RailPins } from "./RailPins";

const roving = () => ({ onFocus: () => {}, tabIndex: -1 });

const state: DaemonState = {
  connection: "connected",
  connectionError: null,
  pendingAgentSetup: null,
  portforwardLogs: {},
  serviceLogs: {},
  sessionUpdates: {},
  snapshot: EMPTY_SNAPSHOT,
  snapshotReady: false,
};

const task: TaskInfo = {
  agent: "codex",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "t_triage",
  project: "warpforge",
  prompt: "Triage open pull requests",
  status: "running",
  tags: [],
  title: "PR triage",
  updatedAt: 1,
};

function pins(state: DaemonState, attentionIds: ReadonlySet<string> = new Set()) {
  return (
    <TooltipProvider>
      <RailPins
        state={state}
        attentionIds={attentionIds}
        nowSec={1}
        onOpenTask={useUi.getState().openTask}
        roving={roving}
      />
    </TooltipProvider>
  );
}

function renderPins() {
  return render(pins(state));
}

beforeEach(() => {
  usePins.setState({ pins: [] });
  useUi.setState({ openTaskId: null, settingsOpen: false, view: "start" });
});

describe("RailPins", () => {
  it("draws nothing while nothing is pinned", () => {
    const { container } = renderPins();
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a pinned project in the Tasks panel and marks it current", () => {
    usePins.setState({ pins: [{ kind: "project", id: "warpforge" }] });
    renderPins();

    fireEvent.click(screen.getByRole("button", { name: "warpforge" }));

    const ui = useUi.getState();
    expect(ui.view).toBe("project");
    expect(ui.selectedProjectId).toBe("warpforge");
    expect(ui.sidebarMode).toBe("tasks");
    expect(document.querySelector('[data-pin="project:warpforge"]')?.className).toContain(
      "ring-primary",
    );
  });

  it("opens a pinned channel as a team conversation", () => {
    usePins.setState({ pins: [{ kind: "channel", id: "warpforge#general", name: "general" }] });
    renderPins();

    fireEvent.click(screen.getByRole("button", { name: "#general" }));

    const ui = useUi.getState();
    expect(ui.view).toBe("team");
    expect(ui.sidebarMode).toBe("team");
    expect(ui.teamSelection).toEqual({ key: "warpforge#general", kind: "conversation" });
  });

  it("opens the pinned task and reflects its status", () => {
    usePins.setState({ pins: [{ kind: "task", id: task.id }] });
    useUi.setState({ sidebarMode: "inbox" });
    const ready = { ...state, snapshot: { ...EMPTY_SNAPSHOT, tasks: [task] }, snapshotReady: true };
    const { rerender } = render(pins(ready, new Set([task.id])));
    const button = screen.getByRole("button", { name: "PR triage" });

    expect(within(button).getByRole("img", { name: "needs you" })).toHaveAttribute(
      "data-status-light",
    );
    fireEvent.click(button);
    expect(useUi.getState()).toMatchObject({ openTaskId: task.id, sidebarMode: "tasks" });
    expect(button).not.toHaveAttribute("aria-current");

    rerender(pins(ready));
    expect(within(button).getByRole("img", { name: /running/i })).toBeInTheDocument();
  });

  it("keeps a saved task pin through the handshake and prunes it after the task is gone", () => {
    const pin = { kind: "task", id: task.id } as const;
    usePins.setState({ pins: [pin] });
    const { rerender } = renderPins();
    expect(usePins.getState().pins).toEqual([pin]);

    const ready = { ...state, snapshot: { ...EMPTY_SNAPSHOT, tasks: [task] }, snapshotReady: true };
    rerender(pins(ready));
    expect(screen.getByRole("button", { name: "PR triage" })).toBeInTheDocument();
    rerender(pins({ ...ready, snapshot: EMPTY_SNAPSHOT }));
    expect(usePins.getState().pins).toEqual([]);
    expect(screen.queryByRole("button", { name: "PR triage" })).not.toBeInTheDocument();
  });
});
