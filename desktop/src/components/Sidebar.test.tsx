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
  return {
    DropdownMenu,
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
      scrollToIndex: vi.fn<(index: number) => void>(),
    };
  },
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "../daemon";
import type { DaemonState } from "../daemon";
import type { ProjectInfo, PullRequestSummary, TaskInfo } from "../protocol";
import { useUi } from "../store/ui";
import type { GlobalView } from "../store/ui";
import Sidebar from "./Sidebar";
import { SidebarTaskTooltipBody } from "./Sidebar/SidebarTaskTooltip";
import { TooltipProvider } from "./ui/tooltip";

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    parentTaskId: null,
    project: "warpforge",
    prompt: id,
    status: "waiting",
    tags: [],
    title: "",
    updatedAt: 1,
    ...overrides,
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

function makeState(
  tasks: TaskInfo[],
  projects: ProjectInfo[] = [project("warpforge")],
): DaemonState {
  return {
    connection: "connected",
    connectionError: null,
    pendingAgentSetup: null,
    portforwardLogs: {},
    serviceLogs: {},
    sessionUpdates: {},
    snapshot: {
      portforwards: [],
      projects,
      services: [],
      tasks,
      terminals: [],
    },
  };
}

const mockRequest = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();

const handlers = {
  onAddProject: vi.fn<() => void>(),
  onNewTask: vi.fn<() => void>(),
  onOpenSettings: vi.fn<() => void>(),
  onOpenTask: vi.fn<(id: string) => void>(),
  onOpenProject: vi.fn<(name: string) => void>(),
  onSelectView: vi.fn<(view: GlobalView) => void>(),
  onSelectTasksSegment: vi.fn<() => void>(),
  onToggleCollapsed: vi.fn<() => void>(),
};

function renderSidebar(
  state: DaemonState,
  overrides: Partial<React.ComponentProps<typeof Sidebar>> = {},
) {
  return render(
    // The sidebar reads the inbox badge through React Query; a fresh client
    // per render keeps one test's cache out of the next. The app normally
    // mounts one TooltipProvider at the root; standalone renders need their own.
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider delayDuration={300} skipDelayDuration={0}>
        <Sidebar
          state={state}
          view="control"
          openTaskId={null}
          collapsed={false}
          {...handlers}
          {...overrides}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function taskRows(id?: string) {
  return screen
    .getAllByRole("button")
    .filter((el) => el.hasAttribute("data-task-id"))
    .filter((el) => (id ? el.getAttribute("data-task-id") === id : true));
}

function rowState(id: string): string | null {
  return taskRows(id)[0]?.getAttribute("data-task-state") ?? null;
}

/** The state the row actually *draws*, as opposed to the one it knows about. */
function rowGlyph(id: string): string | null {
  return (
    taskRows(id)[0]?.querySelector("[data-task-glyph]")?.getAttribute("data-task-glyph") ?? null
  );
}

function openShelf() {
  fireEvent.click(screen.getByRole("button", { name: /^Show \d+ done task/ }));
}

beforeEach(() => {
  vi.spyOn(daemon, "request").mockImplementation(mockRequest);
  useUi.setState({ attentionTargetId: null, attentionTargetNonce: 0, pinnedTaskIds: [] });
  mockRequest.mockReset();
  for (const handler of Object.values(handlers)) handler.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sidebar shell", () => {
  it("renders brand, New task with its shortcut, nav and Settings", () => {
    renderSidebar(makeState([]));

    expect(screen.getByText("WARP")).toBeInTheDocument();
    expect(screen.getByText("FORGE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New task/ })).toBeInTheDocument();
    expect(screen.getByText("⌘N")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Mission Control/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("navigates to global destinations only — the tree is the projects section", () => {
    renderSidebar(makeState([]));

    for (const label of [/^Mission Control/, /^Automations/]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Projects/ })).not.toBeInTheDocument();
    // The inbox is a body segment, not a fourth destination in the nav.
    expect(screen.queryByRole("button", { name: /^Inbox/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Inbox/ })).toBeInTheDocument();
  });

  it("routes New task, nav and Settings through the App callbacks", () => {
    renderSidebar(makeState([]));

    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    expect(handlers.onNewTask).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: /^Inbox/ }));
    expect(handlers.onSelectView).toHaveBeenCalledWith("inbox");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(handlers.onOpenSettings).toHaveBeenCalled();
  });

  it("marks the active view and drops it while a task is open", () => {
    const { rerender } = renderSidebar(makeState([]), { view: "automations" });
    expect(screen.getByRole("button", { name: /^Automations/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider delayDuration={300} skipDelayDuration={0}>
          <Sidebar
            state={makeState([task("t1")])}
            view="automations"
            openTaskId="t1"
            collapsed={false}
            {...handlers}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /^Automations/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("offers to register the first project from the empty tree", () => {
    // With no Projects nav item, an empty registry would otherwise have no
    // path at all to the Add project dialog.
    renderSidebar(makeState([], []));

    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(handlers.onAddProject).toHaveBeenCalled();
  });

  it("collapses to an icon rail that keeps nav and Settings reachable", () => {
    renderSidebar(makeState([task("t1", { prompt: "Hidden when collapsed" })]), {
      collapsed: true,
    });

    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("WARP")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden when collapsed")).not.toBeInTheDocument();
    // Every rail control keeps an accessible name even without a visible label.
    // Both segments are here too: the body is gone at this width, so the rail
    // is the only way back to the tasks side.
    for (const label of ["New task", "Tasks", "Inbox", "Mission Control", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    fireEvent.click(toggle);
    expect(handlers.onToggleCollapsed).toHaveBeenCalled();
  });

  it("is one vertical toolbar tab stop with roving arrow navigation", () => {
    renderSidebar(makeState([]), { collapsed: true });

    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveAttribute("aria-orientation", "vertical");
    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggle).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("tabindex", "-1");

    toggle.focus();
    fireEvent.keyDown(toolbar, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "New task" })).toHaveFocus();

    fireEvent.keyDown(toolbar, { key: "End" });
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
  });
});

describe("Sidebar body segments", () => {
  function segment(name: "Tasks" | "Inbox") {
    return screen.getByRole("tab", { name: new RegExp(`^${name}`) });
  }

  it("reads the active segment off the route rather than a flag of its own", () => {
    const { unmount } = renderSidebar(makeState([]), { view: "control" });
    expect(segment("Tasks")).toHaveAttribute("aria-selected", "true");
    unmount();

    renderSidebar(makeState([]), { view: "inbox" });
    expect(segment("Inbox")).toHaveAttribute("aria-selected", "true");
  });

  it("reads as Tasks once a task takes the column, whatever view it came from", () => {
    renderSidebar(makeState([task("a", { prompt: "Task A" })]), {
      openTaskId: "a",
      view: "inbox",
    });

    expect(segment("Tasks")).toHaveAttribute("aria-selected", "true");
    expect(segment("Inbox")).toHaveAttribute("aria-selected", "false");
  });

  it("asks the host to restore the last task when Tasks is picked from the inbox", () => {
    renderSidebar(makeState([task("a", { prompt: "Task A" })]), { view: "inbox" });

    fireEvent.click(segment("Tasks"));
    expect(handlers.onSelectTasksSegment).toHaveBeenCalled();
    expect(handlers.onSelectView).not.toHaveBeenCalled();
  });

  it("does not navigate when the segment you are already on is picked", () => {
    renderSidebar(makeState([]), { view: "control" });

    fireEvent.click(segment("Tasks"));
    expect(handlers.onSelectTasksSegment).not.toHaveBeenCalled();
    expect(handlers.onSelectView).not.toHaveBeenCalled();
  });

  it("keeps New task and the global nav in both segments", () => {
    renderSidebar(makeState([]), { view: "inbox" });

    expect(screen.getByRole("button", { name: /New task/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Mission Control/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Automations/ })).toBeInTheDocument();
  });
});

describe("Sidebar attention", () => {
  it("has no Needs you section: attention is inline or nowhere", () => {
    renderSidebar(
      makeState([
        task("review", { prompt: "Review me", status: "waiting", filesChanged: 1 }),
        task("blocked", { blockedReason: "no creds", prompt: "Blocked", status: "blocked" }),
      ]),
    );

    expect(screen.queryByText(/Needs you/)).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing blocked")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    // …and no task is listed twice, once per section.
    expect(taskRows("review")).toHaveLength(1);
    expect(taskRows("blocked")).toHaveLength(1);
  });

  it("counts only genuinely blocking work on Mission Control, not the review pile", () => {
    renderSidebar(
      makeState([
        task("r1", { status: "waiting", filesChanged: 1 }),
        task("r2", { status: "waiting", filesChanged: 1 }),
        task("r3", { status: "waiting", filesChanged: 1 }),
        task("blocked", { status: "blocked" }),
      ]),
    );

    // The attention queue holds all four; only the blocked one wants a human.
    expect(
      within(screen.getByRole("button", { name: /Mission Control/ })).getByText("1"),
    ).toBeInTheDocument();
  });

  it("treats a pending permission as needing you", () => {
    const state = makeState([task("perm", { prompt: "Permission", status: "waiting" })]);
    state.sessionUpdates = {
      perm: [
        {
          kind: "permission_request",
          options: ["allow", "deny"],
          request_id: "perm-1",
          title: "Write file?",
        },
      ],
    };
    renderSidebar(state);

    expect(taskRows("perm")).toHaveLength(1);
    expect(rowState("perm")).toBe("needs_answer");
    expect(rowGlyph("perm")).toBe("needs_answer");
  });
});

describe("Sidebar status encoding", () => {
  it("keeps knowing every lifecycle even where it draws nothing", () => {
    renderSidebar(
      makeState([
        task("run", { status: "running" }),
        task("rev", { status: "waiting", filesChanged: 1 }),
        task("queued", { status: "queued" }),
        task("idle", { status: "waiting" }),
      ]),
    );

    expect(rowState("run")).toBe("working");
    expect(rowState("rev")).toBe("review");
    expect(rowState("queued")).toBe("queued");
    expect(rowState("idle")).toBe("idle");
  });

  it("draws a glyph only for work in flight and rows that want a human", () => {
    renderSidebar(
      makeState([
        task("run", { status: "running" }),
        task("blocked", { status: "blocked" }),
        task("lost", { status: "interrupted" }),
        task("rev", { status: "waiting", filesChanged: 1 }),
        task("queued", { status: "queued" }),
        task("idle", { status: "waiting" }),
      ]),
    );

    expect(rowGlyph("run")).toBe("working");
    expect(rowGlyph("blocked")).toBe("blocked");
    expect(rowGlyph("lost")).toBe("failed");
    // The resting majority is title + time and nothing else.
    for (const id of ["rev", "queued", "idle"]) expect(rowGlyph(id)).toBeNull();
  });

  it("reserves the glyph lane on a silent row but draws nothing in it", () => {
    // The lane is fixed so titles align across states; only the content is
    // conditional, preserving the four-glyph restraint.
    renderSidebar(makeState([task("rev", { status: "waiting", filesChanged: 1 })]));

    const row = taskRows("rev")[0];
    expect(row.querySelector('[data-lane="glyph"]')).not.toBeNull();
    expect(row.querySelector("[data-task-glyph]")).toBeNull();
  });

  it("keeps the working row's dashed spinner", () => {
    renderSidebar(makeState([task("run", { status: "running" })]));

    const glyph = taskRows("run")[0].querySelector("[data-task-glyph]")!;
    expect(glyph.getAttribute("class")).toContain("text-ok");
    expect(glyph.getAttribute("class")).toContain("animate-");
  });

  it("lets snooze outrank the reported status without adding a glyph", () => {
    const now = Math.floor(Date.now() / 1000);
    renderSidebar(
      makeState([
        task("later", { snoozedAt: now - 10, snoozedUntil: now + 3600, status: "running" }),
      ]),
    );

    expect(rowState("later")).toBe("snoozed");
    expect(rowGlyph("later")).toBeNull();
    // A snoozed row trades "last touched" for "comes back in".
    expect(within(taskRows("later")[0]).getByText("1h")).toBeInTheDocument();
  });

  it("hides the row actions until the row is hovered or focused", () => {
    renderSidebar(makeState([task("a", { prompt: "Hover me" })]));

    const actions = screen.getAllByRole("button", { name: /Mark handled/ })[0].parentElement!;
    expect(actions.className).toContain("opacity-0");
    expect(actions.className).toContain("group-hover/row:opacity-100");
    expect(actions.className).toContain("group-focus-within/row:opacity-100");

    // …and the resting metadata yields the same lane rather than stacking.
    const meta = within(taskRows("a")[0]).getByText(/^\d+[smhd]$/).parentElement!;
    expect(meta.className).toContain("group-hover/row:opacity-0");
  });
});

describe("Sidebar done shelf", () => {
  it("keeps finished and handled work out of the tree behind a quiet count", () => {
    renderSidebar(
      makeState([
        task("live", { prompt: "Still going", status: "running" }),
        task("finished", { prompt: "Shipped it", status: "done" }),
        task("handled", { prompt: "Dealt with", settledOverride: true }),
      ]),
    );

    expect(screen.getByText("Still going")).toBeInTheDocument();
    expect(screen.queryByText("Shipped it")).not.toBeInTheDocument();
    expect(screen.queryByText("Dealt with")).not.toBeInTheDocument();

    const shelf = screen.getByRole("button", { name: "Show 2 done tasks in warpforge" });
    expect(shelf).toHaveAttribute("aria-expanded", "false");
    expect(within(shelf).getByText("2")).toBeInTheDocument();
    expect(within(shelf).getByText("done")).toBeInTheDocument();
  });

  it("expands to reveal them and collapses again", () => {
    renderSidebar(
      makeState([
        task("live", { prompt: "Still going", status: "running" }),
        task("finished", { prompt: "Shipped it", status: "done" }),
      ]),
    );

    openShelf();
    expect(screen.getByText("Shipped it")).toBeInTheDocument();
    expect(rowState("finished")).toBe("done");
    expect(rowGlyph("finished")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide 1 done task in warpforge" }));
    expect(screen.queryByText("Shipped it")).not.toBeInTheDocument();
  });

  it("counts only live tasks on the project row", () => {
    const { container } = renderSidebar(
      makeState([
        task("live", { prompt: "Still going", status: "running" }),
        task("d1", { status: "done" }),
        task("d2", { status: "done" }),
        task("d3", { settledOverride: true }),
      ]),
    );

    const header = container.querySelector<HTMLElement>('[data-project="warpforge"]')!;
    expect(within(header).getByText("1")).toBeInTheDocument();
    expect(within(header).queryByText("4")).not.toBeInTheDocument();
  });

  it("offers no shelf when a project has no history", () => {
    renderSidebar(makeState([task("live", { status: "running" })]));

    expect(screen.queryByRole("button", { name: /done task/ })).not.toBeInTheDocument();
  });

  it("states the real kept split before the user commits to a bulk delete", () => {
    const onDeleteSettledShelf = vi.fn<(project: string) => Promise<void>>().mockResolvedValue();
    renderSidebar(
      makeState([
        task("finished", { status: "done" }),
        task("handled", { settledOverride: true }),
        // Has a live worktree with unmerged changes — the only genuine keep.
        task("dirty", { settledOverride: true, filesChanged: 3, worktree: "/tmp/wt-dirty" }),
      ]),
      { onDeleteSettledShelf },
    );

    fireEvent.click(screen.getByRole("button", { name: /2 finished tasks.*1 kept/ }));
    expect(
      screen.getByText(
        "Delete 2 finished tasks in warpforge? 1 kept because its worktree still has uncommitted changes.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteSettledShelf).toHaveBeenCalledWith("warpforge");
  });

  it("deletes a settled task whose files-changed count is stale once its worktree is gone", () => {
    renderSidebar(makeState([task("stale", { status: "done", filesChanged: 3 })]));

    expect(screen.getByRole("button", { name: /^Delete 1 finished task$/ })).toBeInTheDocument();
  });

  it("offers no bulk delete when every settled task still has a live worktree with changes", () => {
    renderSidebar(
      makeState([task("dirty", { status: "done", filesChanged: 3, worktree: "/tmp/wt-dirty" })]),
    );

    expect(screen.queryByRole("button", { name: /finished task/ })).not.toBeInTheDocument();
  });

  it("opens the shelf on its own for a task the user was sent to", () => {
    const state = makeState([
      task("live", { prompt: "Still going", status: "running" }),
      task("finished", { prompt: "Buried in history", status: "done" }),
    ]);
    useUi.setState({ attentionTargetId: "finished", attentionTargetNonce: 1 });

    renderSidebar(state);

    expect(screen.getByText("Buried in history")).toBeInTheDocument();
  });

  it("keeps a settled group in the tree while one of its subtasks still runs", () => {
    renderSidebar(
      makeState([
        task("lead", { prompt: "Wrapped parent", status: "done" }),
        task("child", { parentTaskId: "lead", prompt: "Live child", status: "running" }),
      ]),
    );

    expect(screen.getByText("Wrapped parent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /done task/ })).not.toBeInTheDocument();
  });
});

describe("Sidebar workspace tree", () => {
  it("groups tasks under their project with a task count", () => {
    const state = makeState(
      [task("a", { prompt: "Task A" }), task("b", { project: "website", prompt: "Task B" })],
      [project("warpforge"), project("website")],
    );
    const { container } = renderSidebar(state);

    const warpforge = container.querySelector<HTMLElement>('[data-project="warpforge"]')!;
    const website = container.querySelector<HTMLElement>('[data-project="website"]')!;
    expect(within(warpforge).getByText("1")).toBeInTheDocument();
    expect(within(website).getByText("1")).toBeInTheDocument();
    expect(
      warpforge.compareDocumentPosition(website) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("collapses a project group from the chevron and restores it", () => {
    const { container } = renderSidebar(makeState([task("a", { prompt: "Task A" })]));

    const chevron = () =>
      container.querySelector<HTMLElement>('[data-project-disclosure="warpforge"]')!;
    expect(chevron()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chevron());

    expect(screen.queryByText("Task A")).not.toBeInTheDocument();
    expect(chevron()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(chevron());
    expect(screen.getByText("Task A")).toBeInTheDocument();
  });

  it("opens the project from the row itself, leaving disclosure to the chevron", () => {
    const { container } = renderSidebar(makeState([task("a", { prompt: "Task A" })]));

    // One call carries both halves: the store's `openProject` selects the
    // project *and* switches the view, so the row does not also fire
    // `onSelectView` — that would be a second, redundant navigation.
    fireEvent.click(container.querySelector<HTMLElement>('[data-project="warpforge"]')!);
    expect(handlers.onOpenProject).toHaveBeenCalledWith("warpforge");
    expect(handlers.onSelectView).not.toHaveBeenCalled();
    expect(screen.getByText("Task A")).toBeInTheDocument();
  });

  it("does not resurrect a removed project from a task that still names it", () => {
    // Removing a project stops its live resources but never deletes its tasks,
    // so such a task outlives its project. It must not raise a phantom group
    // here — the tree shows registered projects, and nothing else.
    const { container } = renderSidebar(makeState([task("a", { project: "ghost-project" })], []));

    expect(container.querySelector('[data-project="ghost-project"]')).not.toBeInTheDocument();
    expect(taskRows("a")).toHaveLength(0);
  });

  it("keeps subtasks hidden until the expand toggle is used", () => {
    const state = makeState([
      task("lead", { prompt: "Coordinate the release", status: "running" }),
      task("worker-1", { parentTaskId: "lead", prompt: "Update the daemon", status: "running" }),
      task("worker-2", { parentTaskId: "lead", prompt: "Update the board" }),
    ]);
    renderSidebar(state);

    expect(screen.getByText("Coordinate the release")).toBeInTheDocument();
    expect(screen.queryByText("Update the daemon")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", {
      name: "Expand 2 subtasks of Coordinate the release",
    });
    fireEvent.click(toggle);

    expect(screen.getByText("Update the daemon")).toBeInTheDocument();
    expect(screen.getByText("Update the board")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse 2 subtasks of Coordinate the release" }),
    );
    expect(screen.queryByText("Update the daemon")).not.toBeInTheDocument();
  });

  it("draws a synthetic rail for a subtask instead of shifting its box", () => {
    const state = makeState([
      task("lead", { prompt: "Lead" }),
      task("child", { parentTaskId: "lead", prompt: "Child" }),
    ]);
    renderSidebar(state);
    fireEvent.click(screen.getByRole("button", { name: /^Expand 1 subtask of Lead/ }));

    const child = taskRows("child")[0].closest("[data-rail-depth]")!;
    expect(child).toHaveAttribute("data-rail-depth", "1");
    expect(child.className).not.toContain("border-l");
    expect(child).not.toHaveStyle({ marginLeft: "14px" });
    // One connector lane, drawn as an elbow because the child is an only child.
    const connector = child.querySelector('[data-rail-level="0"]');
    expect(connector).not.toBeNull();
    expect(connector).toHaveAttribute("data-rail-shape", "elbow");
  });

  it("gives a working and a silent sibling the same title start", () => {
    const state = makeState([
      task("lead", { prompt: "Lead" }),
      task("busy", { parentTaskId: "lead", prompt: "Busy", status: "running" }),
      task("quiet", { parentTaskId: "lead", prompt: "Quiet" }),
    ]);
    renderSidebar(state);
    fireEvent.click(screen.getByRole("button", { name: /^Expand 2 subtasks of Lead/ }));

    const busyLane = taskRows("busy")[0].querySelector('[data-lane="glyph"]')!;
    const quietLane = taskRows("quiet")[0].querySelector('[data-lane="glyph"]')!;
    expect(busyLane).not.toBeNull();
    expect(quietLane).not.toBeNull();
    expect(busyLane.className).toBe(quietLane.className);
  });

  it("keeps a uniform inter-lane gap so a glyph never touches the title", () => {
    const state = makeState([
      task("lead", { prompt: "Lead", status: "running" }),
      task("child", { parentTaskId: "lead", prompt: "Child", status: "running" }),
    ]);
    renderSidebar(state);
    fireEvent.click(screen.getByRole("button", { name: /^Expand 1 subtask of Lead/ }));

    // Every task row carries the gap, glyph or not, so the state icon, the
    // title, the orchestrator mark and the meta lane are all separated.
    for (const id of ["lead", "child"]) {
      expect(taskRows(id)[0].className).toContain("gap-2");
    }
    // …and the reserved glyph lane still holds its box, keeping title x stable.
    expect(taskRows("child")[0].querySelector('[data-lane="glyph"]')).not.toBeNull();
  });

  it("draws a lane for every continuing ancestor", () => {
    const state = makeState([
      task("a", { prompt: "A", updatedAt: 100 }),
      task("a2", { prompt: "A2", updatedAt: 1 }),
      task("b", { parentTaskId: "a", prompt: "B" }),
      task("c", { parentTaskId: "b", prompt: "C" }),
    ]);
    renderSidebar(state);
    fireEvent.click(screen.getByRole("button", { name: / of A$/ }));
    fireEvent.click(screen.getByRole("button", { name: / of B$/ }));

    // A has a following sibling, so its lane passes beside C; level 1 is C's
    // own connector.
    const c = taskRows("c")[0].closest("[data-rail-depth]")!;
    expect(c.querySelector('[data-rail-level="0"]')).not.toBeNull();
    expect(c.querySelector('[data-rail-level="1"]')).not.toBeNull();
  });

  it("ends the rail with an elbow for a last child and a tee otherwise", () => {
    const state = makeState([
      task("lead", { prompt: "Lead", status: "running" }),
      task("one", { parentTaskId: "lead", prompt: "One", status: "running" }),
      task("two", { parentTaskId: "lead", prompt: "Two", status: "running" }),
    ]);
    renderSidebar(state);
    fireEvent.click(screen.getByRole("button", { name: /^Expand 2 subtasks of Lead/ }));

    const one = taskRows("one")[0].closest("[data-rail-depth]")!;
    const two = taskRows("two")[0].closest("[data-rail-depth]")!;
    expect(one.querySelector('[data-rail-level="0"]')).toHaveAttribute("data-rail-shape", "tee");
    expect(two.querySelector('[data-rail-level="0"]')).toHaveAttribute("data-rail-shape", "elbow");
  });

  it("paints the primary rail along the open task's branch only", () => {
    const state = makeState([
      task("lead", { prompt: "Lead", status: "running" }),
      task("mid", { parentTaskId: "lead", prompt: "Mid", status: "running" }),
      task("leaf", { parentTaskId: "mid", prompt: "Leaf", status: "running" }),
      task("other", { parentTaskId: "lead", prompt: "Other", status: "running" }),
    ]);
    renderSidebar(state, { openTaskId: "leaf" });

    const mid = taskRows("mid")[0].closest("[data-rail-depth]")!;
    const leaf = taskRows("leaf")[0].closest("[data-rail-depth]")!;
    const other = taskRows("other")[0].closest("[data-rail-depth]")!;
    expect(mid.querySelector("[data-rail-active]")).not.toBeNull();
    expect(leaf.querySelector("[data-rail-active]")).not.toBeNull();
    expect(other.querySelector("[data-rail-active]")).toBeNull();
  });

  it("has no expand control for a task without children", () => {
    renderSidebar(makeState([task("solo", { prompt: "Solo task" })]));

    expect(screen.queryByRole("button", { name: /subtask/ })).not.toBeInTheDocument();
  });

  it("opens a task when its row is clicked", () => {
    renderSidebar(makeState([task("a", { prompt: "Task A" })]));

    fireEvent.click(taskRows("a")[0]);
    expect(handlers.onOpenTask).toHaveBeenCalledWith("a");
  });

  it("says so when there are no projects at all, and when a project is empty", () => {
    const { unmount } = renderSidebar(makeState([], []));
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    unmount();

    renderSidebar(makeState([]));
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });
});

describe("Sidebar attention target", () => {
  it("expands the ancestors of a targeted subtask so it becomes visible", () => {
    const state = makeState([
      task("lead", { prompt: "Lead", status: "running" }),
      task("child", { parentTaskId: "lead", prompt: "Hidden child", status: "running" }),
    ]);
    useUi.setState({ attentionTargetId: "child", attentionTargetNonce: 1 });

    renderSidebar(state);

    expect(screen.getByText("Hidden child")).toBeInTheDocument();
  });

  it("expands the ancestors of the currently open subtask", () => {
    const state = makeState([
      task("lead", { prompt: "Lead", status: "running" }),
      task("child", { parentTaskId: "lead", prompt: "Open child", status: "running" }),
    ]);

    renderSidebar(state, { openTaskId: "child" });

    expect(screen.getByText("Open child")).toBeInTheDocument();
  });

  it("re-opens a collapsed project when a task inside it is targeted", () => {
    const { container } = renderSidebar(makeState([task("a", { prompt: "Task A" })]));

    fireEvent.click(container.querySelector<HTMLElement>('[data-project-disclosure="warpforge"]')!);
    expect(screen.queryByText("Task A")).not.toBeInTheDocument();

    act(() => useUi.setState({ attentionTargetId: "a", attentionTargetNonce: 2 }));
    expect(screen.getByText("Task A")).toBeInTheDocument();
  });
});

describe("Sidebar row actions", () => {
  it("snoozes a task from the row's remind-later menu", async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    const { container } = renderSidebar(makeState([task("a", { prompt: "Snooze me" })]));

    fireEvent.click(container.querySelector<HTMLElement>('[data-snooze-preset="one-hour"]')!);

    await vi.waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        "task.snooze",
        expect.objectContaining({ task_id: "a" }),
      ),
    );
  });

  it("settles a non-running task and offers no settle for a running one", async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    const { unmount } = renderSidebar(makeState([task("a", { prompt: "Settle me" })]));

    fireEvent.click(screen.getAllByRole("button", { name: "Mark handled: Settle me" })[0]);
    await vi.waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith("task.settle", { task_id: "a" }),
    );
    unmount();

    renderSidebar(makeState([task("b", { prompt: "Running", status: "running" })]));
    expect(screen.queryByRole("button", { name: /Mark handled/ })).not.toBeInTheDocument();
  });

  it("wakes a snoozed task and un-settles a handled one", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockRequest.mockResolvedValue(undefined);
    const { unmount } = renderSidebar(
      makeState([task("a", { prompt: "Snoozed", snoozedAt: now - 10, snoozedUntil: now + 3600 })]),
    );

    expect(screen.queryByRole("button", { name: /Mark handled/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Wake now: Snoozed" })[0]);
    await vi.waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith("task.unsnooze", { task_id: "a" }),
    );
    unmount();

    // A handled task lives on the shelf, and stays actionable once revealed.
    renderSidebar(makeState([task("b", { prompt: "Handled", settledOverride: true })]));
    openShelf();
    fireEvent.click(screen.getAllByRole("button", { name: "Return to active: Handled" })[0]);
    await vi.waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith("task.unsettle", { task_id: "b" }),
    );
  });

  it("pins and unpins the task group from the row menu", () => {
    renderSidebar(makeState([task("a", { prompt: "Pin me" })]));

    fireEvent.click(screen.getAllByText("Pin to Mission Control")[0]);
    expect(useUi.getState().pinnedTaskIds).toEqual(["a"]);
  });

  it("surfaces a daemon rejection as a toast without wedging the row", async () => {
    mockRequest.mockRejectedValueOnce(new Error("daemon rejected settle"));
    renderSidebar(makeState([task("a", { prompt: "Settle me" })]));

    fireEvent.click(screen.getAllByRole("button", { name: "Mark handled: Settle me" })[0]);

    await vi.waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith("task.settle", { task_id: "a" }),
    );
    await vi.waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Mark handled: Settle me" })[0]).toBeEnabled(),
    );
  });
});

describe("Sidebar inbox mode", () => {
  const pull: PullRequestSummary = {
    assignees: [],
    baseRefName: "main",
    createdAt: 0,
    draft: false,
    headRefName: "widget",
    labels: [],
    number: 7,
    project: "warpforge",
    repo: "acme/widgets",
    state: "open",
    title: "Add widget",
    updatedAt: 0,
    url: "https://github.test/pull/7",
  };

  it("swaps the tree for the pull-request list, keeping everything global", async () => {
    vi.spyOn(daemon, "listPulls").mockResolvedValue([pull]);
    renderSidebar(makeState([task("a", { prompt: "Task A" })]), { view: "inbox" });

    expect(await screen.findByText("Add widget")).toBeInTheDocument();
    expect(screen.queryByText("Task A")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Inbox/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /New task/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("restores the tree once a task is open, so the new task is never invisible", () => {
    vi.spyOn(daemon, "listPulls").mockResolvedValue([pull]);
    renderSidebar(makeState([task("a", { prompt: "Task A" })]), {
      openTaskId: "a",
      view: "inbox",
    });

    expect(screen.getByText("Task A")).toBeInTheDocument();
    expect(screen.queryByText("Add widget")).not.toBeInTheDocument();
  });
});

describe("Sidebar task tooltip", () => {
  it("carries the context that does not fit on the row", () => {
    const now = Math.floor(Date.now() / 1000);
    render(
      <SidebarTaskTooltipBody
        task={task("a", {
          agent: "claude",
          blockedReason: "missing credentials",
          filesChanged: 3,
          project: "warpforge",
          prompt: "Wire the callback",
          status: "blocked",
          worktree: "/tmp/wt/feature-auth",
        })}
        state="blocked"
        childCount={2}
        nowSec={now}
      />,
    );

    expect(screen.getByText("Wire the callback")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("warpforge")).toBeInTheDocument();
    expect(screen.getByText("/tmp/wt/feature-auth")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText(/2 subtasks/)).toBeInTheDocument();
    expect(screen.getByText(/files? changed/)).toBeInTheDocument();
    expect(screen.getByText("missing credentials")).toBeInTheDocument();
  });

  it("shows a snoozed task's return ticket instead of its last touch", () => {
    const now = Math.floor(Date.now() / 1000);
    render(
      <SidebarTaskTooltipBody
        task={task("a", { prompt: "Later", snoozedAt: now - 10, snoozedUntil: now + 7200 })}
        state="snoozed"
        childCount={0}
        nowSec={now}
      />,
    );

    expect(screen.getByText(/back in/)).toBeInTheDocument();
    expect(screen.getByText("2h")).toBeInTheDocument();
  });
});
