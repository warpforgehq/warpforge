import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { Snapshot, TaskInfo } from "@/protocol";
import { useTabs } from "@/store/tabs";

import { TaskTabs } from "./TaskTabs";

function task(id: string, title: string): TaskInfo {
  return {
    id,
    title,
    prompt: title,
    project: "warpforge",
    agent: "claude",
    status: "waiting",
    createdAt: 0,
    updatedAt: 0,
  } as unknown as TaskInfo;
}

const snapshot = {
  tasks: [task("a", "Alpha"), task("b", "Beta"), task("c", "Gamma")],
} as unknown as Snapshot;

function renderBar(
  openTaskId: string | null,
  handlers = {
    open: vi.fn<(id: string) => void>(),
    closeActive: vi.fn<(id: string | null) => void>(),
  },
) {
  const view = render(
    <TaskTabs
      snapshot={snapshot}
      openTaskId={openTaskId}
      onOpenTask={handlers.open}
      onCloseActive={handlers.closeActive}
    />,
  );
  return { ...view, handlers };
}

beforeEach(() => {
  useTabs.setState({ open: [], closed: [] });
});

describe("title bar tabs", () => {
  it("gives the task on screen a tab and keeps the others", () => {
    useTabs.setState({ open: ["a", "c"] });
    renderBar("b");
    const names = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(names).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Beta");
  });

  it("closing the tab on screen hands over to its neighbour without touching the task", () => {
    useTabs.setState({ open: ["a", "b", "c"] });
    const { handlers } = renderBar("b");
    fireEvent.click(screen.getByRole("button", { name: "Close tab Beta" }));
    expect(handlers.closeActive).toHaveBeenCalledWith("c");
    expect(useTabs.getState().open).toEqual(["a", "c"]);
  });

  it("closes a background tab on middle click and opens one on click", () => {
    useTabs.setState({ open: ["a", "b", "c"] });
    const { handlers } = renderBar("a");
    fireEvent(
      screen.getByRole("tab", { name: /Gamma/ }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(useTabs.getState().open).toEqual(["a", "b"]);
    expect(handlers.closeActive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /Beta/ }));
    expect(handlers.open).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByRole("tab", { name: /Alpha/ }));
    expect(handlers.open).toHaveBeenCalledTimes(1);
  });

  it("renames a task from its tab on double-click", () => {
    const setTitle = vi.spyOn(daemon, "setTaskTitle").mockResolvedValue(undefined as never);
    useTabs.setState({ open: ["a"] });
    renderBar("a");
    fireEvent.doubleClick(screen.getByRole("tab", { name: /Alpha/ }));
    const input = screen.getByRole("textbox", { name: "Task title" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(setTitle).toHaveBeenCalledWith("a", "Renamed");
  });

  it("drops tabs of tasks that left the board", () => {
    useTabs.setState({ open: ["a", "gone"] });
    renderBar(null);
    expect(useTabs.getState().open).toEqual(["a"]);
  });
});
