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
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { daemon, type DaemonState } from "@/daemon";
import type { ProjectInfo, Space, TaskInfo } from "@/protocol";
import { usePins } from "@/store/pins";
import { useUi } from "@/store/ui";

import Sidebar from ".";

function task(id: string, projectName: string): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    parentTaskId: null,
    project: projectName,
    prompt: id,
    status: "waiting",
    tags: [],
    title: `Task ${id}`,
    updatedAt: 1,
  };
}

function project(name: string): ProjectInfo {
  return {
    declaredServices: [],
    name,
    path: `/work/${name}`,
    portRange: [4000, 4099],
  };
}

const payments: Space = {
  id: "s1",
  members: [
    { kind: "project", name: "alpha" },
    { kind: "project", name: "beta" },
    { kind: "folder", name: "schemas", path: "/work/schemas" },
  ],
  name: "Payments",
};

const state: DaemonState = {
  connection: "connected",
  connectionError: null,
  pendingAgentSetup: null,
  portforwardLogs: {},
  serviceLogs: {},
  sessionUpdates: {},
  snapshot: {
    portforwards: [],
    projects: [project("alpha"), project("beta"), project("gamma")],
    services: [],
    spaces: [payments],
    tasks: [task("a-1", "alpha"), task("b-1", "beta"), task("g-1", "gamma")],
    terminals: [],
  },
};

const onNewTask = vi.fn<(project?: string) => void>();

function SidebarHost() {
  const view = useUi((s) => s.view);
  const mode = useUi((s) => s.sidebarMode);
  const openTaskId = useUi((s) => s.openTaskId);
  const ui = useUi.getState();
  return (
    <Sidebar
      state={state}
      view={view}
      mode={mode}
      openTaskId={openTaskId}
      collapsed={false}
      onToggleCollapsed={() => {}}
      onSelectMode={() => {}}
      onOpenTask={ui.openTask}
      onNewTask={onNewTask}
      onOpenProject={ui.openProject}
      onAddProject={() => {}}
      onOpenSettings={() => {}}
    />
  );
}

const initial = useUi.getInitialState();

beforeEach(() => {
  vi.spyOn(daemon, "getState").mockReturnValue(state);
  vi.spyOn(daemon, "request").mockResolvedValue([]);
  vi.spyOn(daemon, "listBacklog").mockResolvedValue({
    hasNextPage: false,
    items: [],
    page: 0,
    pageSize: 1,
    total: 0,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarHost />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  act(() => useUi.getState().openSpace("s1"));
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(initial, true);
  onNewTask.mockReset();
});

it("lists the space's members and its projects' tasks, grouped by project", () => {
  expect(screen.getByRole("heading", { name: "Payments", level: 2 })).toBeInTheDocument();
  const members = screen.getByRole("list", { name: "Payments members" });
  expect(within(members).getByRole("button", { name: /alpha/ })).toBeInTheDocument();
  expect(within(members).getByText("/work/schemas")).toBeInTheDocument();
  expect(within(members).queryByRole("button", { name: /schemas/ })).not.toBeInTheDocument();

  expect(document.querySelector('[data-project="alpha"]')).not.toBeNull();
  expect(document.querySelector('[data-project="beta"]')).not.toBeNull();
  expect(screen.getByText("Task a-1")).toBeInTheDocument();
  expect(screen.getByText("Task b-1")).toBeInTheDocument();
  expect(screen.queryByText("Task g-1")).not.toBeInTheDocument();
});

it("opens a member project's mode, whose back chevron returns to the space", () => {
  const members = screen.getByRole("list", { name: "Payments members" });
  fireEvent.click(within(members).getByRole("button", { name: /beta/ }));
  expect(useUi.getState().panelScope).toEqual({ kind: "project", name: "beta", via: "s1" });
  expect(screen.queryByText("Task a-1")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Back to Payments" }));
  expect(useUi.getState().panelScope).toEqual({ kind: "space", id: "s1" });
  expect(screen.getByText("Task a-1")).toBeInTheDocument();
});

it("returns a space member opened from every project to every project", () => {
  act(() => {
    useUi.getState().exitPanelScope();
    useUi.getState().openProject("beta");
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to all projects" }));
  expect(useUi.getState().panelScope).toBeNull();
});

it("starts a new task in the project you came from", () => {
  act(() => useUi.setState({ selectedProjectId: "beta" }));
  fireEvent.click(screen.getByRole("button", { name: "New task in Payments" }));
  expect(onNewTask).toHaveBeenCalledWith("beta");
});

it("returns to every project from the back chevron", () => {
  fireEvent.click(screen.getByRole("button", { name: "Back to all projects" }));
  expect(useUi.getState().panelScope).toBeNull();
  expect(screen.getByText("Task g-1")).toBeInTheDocument();
});

it("switches to a space from a project's switcher", () => {
  act(() => useUi.getState().openProject("gamma"));
  expect(screen.queryByRole("button", { name: /^in / })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: /Payments/ }));
  expect(useUi.getState().panelScope).toEqual({ kind: "space", id: "s1" });
  expect(useUi.getState().selectedProjectId).toBe("alpha");
});

it("keeps the selected project when it is already in the space", () => {
  act(() => {
    useUi.setState({ selectedProjectId: "beta" });
    useUi.getState().openSpace("s1");
  });
  expect(useUi.getState().selectedProjectId).toBe("beta");
});

it("pins and unpins the space from its header", () => {
  act(() => usePins.setState({ pins: [] }));
  fireEvent.click(screen.getByRole("button", { name: "Pin to rail" }));
  expect(usePins.getState().pins).toEqual([{ id: "s1", kind: "space" }]);

  fireEvent.click(screen.getByRole("button", { name: "Unpin from rail" }));
  expect(usePins.getState().pins).toEqual([]);
});
