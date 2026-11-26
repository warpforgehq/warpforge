import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { daemon, type DaemonState } from "@/daemon";
import type { TaskInfo } from "@/protocol";

import Sidebar from ".";
import { SIDEBAR_BODY_ID } from "./modes";

const originalResizeObserver = window.ResizeObserver;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.ResizeObserver = originalResizeObserver;
});

it("updates the task rows when the mounted viewport is measured, resized, and scrolled", () => {
  const now = 100;
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  const tasks: TaskInfo[] = Array.from({ length: 80 }, (_, index) => ({
    agent: "codex",
    blockedReason: null,
    createdAt: now,
    filesChanged: 0,
    id: `task-${index}`,
    parentTaskId: null,
    project: "fixture",
    prompt: `Fixture task ${index}`,
    status: "running",
    tags: [],
    title: "",
    updatedAt: now - index,
  }));
  const state: DaemonState = {
    ...daemon.getState(),
    snapshot: {
      portforwards: [],
      projects: [
        {
          agentTemplates: {},
          declaredServices: [],
          name: "fixture",
          path: "/fixture",
          portRange: [4000, 4099],
        },
      ],
      services: [],
      tasks,
      terminals: [],
    },
  };

  // jsdom has no layout. Feed the real virtualizer height changes for the
  // scroller while keeping Sidebar's props and row data stable.
  let viewportHeight = 0;
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.id === SIDEBAR_BODY_ID ? viewportHeight : 0;
    },
  );
  const resizeCallbacks = new Map<Element, () => void>();
  window.ResizeObserver = class implements ResizeObserver {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      resizeCallbacks.set(element, () => this.callback([], this));
    }
    unobserve(element: Element) {
      resizeCallbacks.delete(element);
    }
    disconnect() {}
  };

  const noop = () => {};
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Sidebar
          state={state}
          view="control"
          mode="tasks"
          openTaskId={null}
          collapsed={false}
          onToggleCollapsed={noop}
          onSelectView={noop}
          onSelectMode={noop}
          onOpenTask={noop}
          onNewTask={noop}
          onOpenProject={noop}
          onAddProject={noop}
          onOpenSettings={noop}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const scroller = container.querySelector<HTMLElement>(`#${SIDEBAR_BODY_ID}`)!;
  const resize = (height: number) => {
    viewportHeight = height;
    act(() => resizeCallbacks.get(scroller)!());
  };

  resize(120);
  expect(screen.getByText("Fixture task 0")).toBeInTheDocument();
  expect(screen.queryByText("Fixture task 25")).not.toBeInTheDocument();

  resize(792);
  expect(screen.getByText("Fixture task 25")).toBeInTheDocument();

  scroller.scrollTop = 500;
  fireEvent.scroll(scroller);
  expect(screen.queryByText("Fixture task 0")).not.toBeInTheDocument();
  expect(screen.getByText("Fixture task 45")).toBeInTheDocument();
});
