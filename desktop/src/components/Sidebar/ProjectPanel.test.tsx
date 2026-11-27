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
import type { ProjectInfo, ServiceInfo, TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

import Sidebar from ".";

function task(id: string, project: string): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    parentTaskId: null,
    project,
    prompt: id,
    status: "waiting",
    tags: [],
    title: `Task ${id}`,
    updatedAt: 1,
  };
}

function project(name: string): ProjectInfo {
  return {
    agentTemplates: {},
    declaredServices: [],
    name,
    path: `~/workspace/${name}`,
    portRange: [4000, 4099],
  };
}

const failed: ServiceInfo = {
  allocatedPort: 4000,
  command: "bun run dev",
  logSeq: 0,
  name: "api",
  originalPort: 3000,
  project: "alpha",
  status: "failed",
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
    projects: [project("alpha"), project("beta")],
    services: [failed],
    tasks: [task("a-1", "alpha"), task("b-1", "beta")],
    terminals: [],
  },
};

const onNewTask = vi.fn<(project?: string) => void>();

/** The sidebar wired to the store the way App wires it. */
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
      onSelectMode={(next) => {
        ui.setSidebarMode(next);
        if (next === "tasks") ui.selectTasksSegment(null);
      }}
      onOpenTask={ui.openTask}
      onNewTask={onNewTask}
      onOpenProject={ui.openProject}
      onAddProject={() => {}}
      onOpenSettings={() => {}}
    />
  );
}

function renderSidebar() {
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
  vi.spyOn(daemon, "getState").mockReturnValue(state);
  vi.spyOn(daemon, "request").mockResolvedValue([]);
  vi.spyOn(daemon, "listBacklog").mockResolvedValue({
    hasNextPage: false,
    items: [],
    page: 0,
    pageSize: 1,
    total: 7,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(initial, true);
  onNewTask.mockReset();
});

function sections() {
  return screen.getByRole("navigation", { name: "alpha sections" });
}

function enterAlphaFromTree() {
  const { container } = renderSidebar();
  fireEvent.click(container.querySelector<HTMLElement>('[data-project="alpha"]')!);
}

it("enters project mode from the tree and lists only that project's tasks", () => {
  enterAlphaFromTree();

  expect(screen.getByRole("heading", { name: "alpha", level: 2 })).toBeInTheDocument();
  expect(screen.getByText("Task a-1")).toBeInTheDocument();
  expect(screen.queryByText("Task b-1")).not.toBeInTheDocument();
  expect(document.querySelector('[data-project="alpha"]')).toBeNull();
  expect(useUi.getState().view).toBe("project");
});

it("lists the sections with counts and a light for a failed service", async () => {
  enterAlphaFromTree();

  const nav = sections();
  for (const label of ["Backlog", "Pull requests", "Explorer", "Runtime", "Terminal"]) {
    expect(within(nav).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
  }
  expect(within(nav).getByRole("button", { name: /Backlog/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(await within(nav).findByText("7")).toBeInTheDocument();
  expect(within(nav).getByRole("img", { name: "A service failed" })).toBeInTheDocument();
});

it("remembers the section per project across the switcher", () => {
  enterAlphaFromTree();

  fireEvent.click(within(sections()).getByRole("button", { name: /Runtime/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /beta/ }));
  const beta = screen.getByRole("navigation", { name: "beta sections" });
  expect(within(beta).getByRole("button", { name: /Backlog/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  fireEvent.click(screen.getByRole("menuitem", { name: /alpha/ }));
  expect(within(sections()).getByRole("button", { name: /Runtime/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("keeps project mode while opening one of its tasks", () => {
  enterAlphaFromTree();

  fireEvent.click(screen.getByText("Task a-1"));
  expect(useUi.getState().openTaskId).toBe("a-1");
  expect(screen.getByRole("heading", { name: "alpha", level: 2 })).toBeInTheDocument();
  expect(within(sections()).getByRole("button", { name: /Backlog/ })).not.toHaveAttribute(
    "aria-current",
  );
});

it("starts a task in the project from the Tasks label", () => {
  enterAlphaFromTree();

  fireEvent.click(screen.getByRole("button", { name: "New task in alpha" }));
  expect(onNewTask).toHaveBeenCalledWith("alpha");
});

it("returns to every project from the back chevron", () => {
  enterAlphaFromTree();

  fireEvent.click(screen.getByRole("button", { name: "Back to all projects" }));
  expect(useUi.getState().panelScope).toBeNull();
  expect(screen.getByText("Task b-1")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Tasks", level: 2 })).toBeInTheDocument();
});

it("returns to every project from the Tasks rail button", () => {
  enterAlphaFromTree();

  const modes = screen.getByRole("navigation", { name: "Modes" });
  fireEvent.click(within(modes).getByRole("button", { name: /^Tasks/ }));
  expect(useUi.getState().panelScope).toBeNull();
  expect(screen.getByText("Task b-1")).toBeInTheDocument();
});

it("drops hidden sections and moves off a hidden open section", () => {
  enterAlphaFromTree();
  act(() => useUi.getState().setProjectSectionHidden("backlog", true));

  const nav = sections();
  expect(within(nav).queryByRole("button", { name: /Backlog/ })).not.toBeInTheDocument();
  expect(within(nav).getAllByRole("button")[0]).toHaveAccessibleName(/Pull requests/);
  expect(within(nav).getByRole("button", { name: /Pull requests/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
