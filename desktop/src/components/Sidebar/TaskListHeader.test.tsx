vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  function DropdownMenu({ children }: { children: React.ReactNode }) {
    return React.createElement("div", { "data-dropdown-root": true }, children);
  }
  function DropdownMenuTrigger({
    asChild,
    children,
  }: {
    asChild?: boolean;
    children: React.ReactElement;
  }) {
    if (asChild) return children;
    return React.createElement("div", null, children);
  }
  function DropdownMenuContent({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return React.createElement("div", { ...props, "data-dropdown-content": true }, children);
  }
  function DropdownMenuItem({
    children,
    onSelect,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { onSelect?: () => void }) {
    return React.createElement(
      "div",
      {
        ...props,
        role: "menuitem",
        onClick: () => onSelect?.(),
      },
      children,
    );
  }
  function DropdownMenuPortal({ children }: { children: React.ReactNode }) {
    return children;
  }
  function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
    return React.createElement("div", { role: "label" }, children);
  }
  function DropdownMenuSeparator() {
    return React.createElement("div", { role: "separator" });
  }
  function DropdownMenuRadioGroup({ children }: { children: React.ReactNode }) {
    return React.createElement("div", { role: "group" }, children);
  }
  function DropdownMenuRadioItem({ children }: { children: React.ReactNode }) {
    return React.createElement("div", { role: "menuitemradio" }, children);
  }
  return {
    DropdownMenu,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuLabel,
    DropdownMenuSeparator,
  };
});

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: {
    count: number;
    estimateSize: (index: number) => number;
    getItemKey: (index: number) => string | number;
    overscan?: number;
  }) => {
    const items = Array.from({ length: opts.count }, (_, i) => ({
      index: i,
      key: opts.getItemKey(i),
      start: i * opts.estimateSize(i),
      size: opts.estimateSize(i),
      end: (i + 1) * opts.estimateSize(i),
    }));
    let totalSize = 0;
    for (let i = 0; i < opts.count; i++) totalSize += opts.estimateSize(i);
    return {
      getVirtualItems: () => items,
      getTotalSize: () => totalSize,
      measureElement: vi.fn<(el: Element) => void>(),
      measure: vi.fn<() => void>(),
      scrollToIndex: vi.fn<(index: number) => void>(),
    };
  },
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { daemon, type DaemonState } from "@/daemon";
import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

import Sidebar from ".";

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    parentTaskId: null,
    project: "alpha",
    prompt: id,
    status: "waiting",
    tags: [],
    title: `Task ${id}`,
    updatedAt: 1,
    ...overrides,
  };
}

let state: DaemonState;

function makeState(tasks: TaskInfo[]): DaemonState {
  return {
    connection: "connected",
    connectionError: null,
    pendingAgentSetup: null,
    portforwardLogs: {},
    serviceLogs: {},
    sessionUpdates: {},
    snapshot: {
      portforwards: [],
      projects: [{ declaredServices: [], name: "alpha", path: "~/alpha", portRange: [4000, 4099] }],
      services: [],
      tasks,
      terminals: [],
    },
  };
}

const chat = (id: string, overrides: Partial<TaskInfo> = {}) =>
  task(id, { kind: "chat", project: "", ...overrides });

const onNewChat = vi.fn<() => void>();

function SidebarHost() {
  const view = useUi((s) => s.view);
  const openTaskId = useUi((s) => s.openTaskId);
  const ui = useUi.getState();
  return (
    <Sidebar
      state={state}
      view={view}
      mode="tasks"
      openTaskId={openTaskId}
      collapsed={false}
      onToggleCollapsed={() => {}}
      onSelectMode={() => {}}
      onOpenTask={ui.openTask}
      onNewTask={() => {}}
      onNewChat={onNewChat}
      onOpenProject={ui.openProject}
      onAddProject={() => {}}
      onOpenSettings={() => {}}
    />
  );
}

function renderSidebar(tasks: TaskInfo[]) {
  state = makeState(tasks);
  vi.spyOn(daemon, "getState").mockReturnValue(state);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarHost />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const initial = useUi.getInitialState();

beforeEach(() => {
  vi.spyOn(daemon, "request").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(initial, true);
  onNewChat.mockReset();
});

const switcher = () => screen.getByRole("button", { name: /^Switch list/ });

it("shows project tasks without chats under Tasks", () => {
  renderSidebar([task("a-1"), chat("c-1")]);

  expect(screen.getByRole("heading", { name: "Tasks", level: 2 })).toBeInTheDocument();
  expect(screen.getByText("Task a-1")).toBeInTheDocument();
  expect(screen.queryByText("Task c-1")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
});

it("switches to Chats, listing only chats with a + for a new one", () => {
  renderSidebar([task("a-1"), chat("c-1")]);

  fireEvent.click(screen.getByRole("menuitem", { name: /^Chats/ }));

  expect(screen.getByRole("heading", { name: "Chats", level: 2 })).toBeInTheDocument();
  expect(screen.getByText("Task c-1")).toBeInTheDocument();
  expect(screen.queryByText("Task a-1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(onNewChat).toHaveBeenCalledOnce();
});

it("says so quietly when there are no chats", () => {
  useUi.setState({ taskListView: "chats" });
  renderSidebar([task("a-1")]);

  expect(screen.getByText("No chats yet")).toBeInTheDocument();
});

it("flags a chat that needs you while Tasks is shown", () => {
  renderSidebar([task("a-1"), chat("c-1", { status: "blocked" })]);

  expect(screen.getByTestId("task-list-attention")).toBeInTheDocument();
  expect(switcher()).toHaveAccessibleName("Switch list: Tasks, chats 1 needs you");
  expect(screen.getByRole("menuitem", { name: /^Chats/ })).toHaveTextContent("1");

  fireEvent.click(screen.getByRole("menuitem", { name: /^Chats/ }));
  expect(screen.queryByTestId("task-list-attention")).not.toBeInTheDocument();
});

it("opening a chat flips the panel to Chats and a project task flips it back", () => {
  renderSidebar([task("a-1"), chat("c-1")]);

  act(() => useUi.getState().openTask("c-1"));
  expect(screen.getByRole("heading", { name: "Chats", level: 2 })).toBeInTheDocument();
  act(() => useUi.getState().openTask("a-1"));
  expect(screen.getByRole("heading", { name: "Tasks", level: 2 })).toBeInTheDocument();
});

it("opens a project from the menu and back returns to the last list", () => {
  useUi.setState({ taskListView: "chats" });
  renderSidebar([task("a-1"), chat("c-1")]);

  fireEvent.click(screen.getByRole("menuitem", { name: "alpha" }));
  expect(screen.getByRole("heading", { name: "alpha", level: 2 })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
  expect(screen.getByRole("heading", { name: "Chats", level: 2 })).toBeInTheDocument();
});

it("the switcher is a focusable button", () => {
  renderSidebar([task("a-1")]);
  switcher().focus();
  expect(switcher()).toHaveFocus();
  expect(switcher().tagName).toBe("BUTTON");
});
