import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, useUi } from "./store/ui";

vi.mock("./daemon", () => {
  const stableState = {
    connection: "connected" as const,
    connectionError: null,
    pendingAgentSetup: null,
    portforwardLogs: {},
    serviceLogs: {},
    sessionUpdates: {},
    snapshot: {
      portforwards: [],
      projects: [],
      services: [],
      tasks: [],
      terminals: [],
    },
  };
  const subscribe = vi.fn<() => () => void>(() => () => {});
  const getState = vi.fn<() => typeof stableState>(() => stableState);
  return {
    daemon: {
      subscribe,
      getState,
      dismissAgentSetup: vi.fn<() => void>(),
      request: vi.fn<() => Promise<unknown>>(),
    },
  };
});

vi.mock("./hooks/useMediaQuery", () => ({
  useMediaQuery: vi.fn<(query: string) => boolean>(),
}));

vi.mock("./hooks/useFontScaling", () => ({ useFontScaling: vi.fn<() => void>() }));
vi.mock("./hooks/useTheme", () => ({ useTheme: vi.fn<() => void>() }));
vi.mock("./hooks/useDaemonEvents", () => ({ useDaemonEvents: vi.fn<() => void>() }));
vi.mock("./hooks/useTauriClose", () => ({ useTauriClose: vi.fn<() => void>() }));
vi.mock("./hooks/usePullShortcut", () => ({ usePullShortcut: vi.fn<() => void>() }));
vi.mock("./hooks/usePushShortcut", () => ({ usePushShortcut: vi.fn<() => void>() }));

vi.mock("./views/MissionControl", () => ({
  default: (props: { onOpenTask: (id: string) => void }) => (
    <div data-testid="mission-control" onClick={() => props.onOpenTask("task-1")} />
  ),
}));
vi.mock("./views/Projects", () => ({
  default: vi.fn<() => React.ReactNode>(() => <div data-testid="projects" />),
}));
vi.mock("./views/InboxView", () => ({
  default: vi.fn<() => React.ReactNode>(() => <div data-testid="inbox" />),
}));
vi.mock("./views/Automations", () => ({
  default: vi.fn<() => React.ReactNode>(() => <div data-testid="automations" />),
}));
vi.mock("./views/TaskDetail", () => ({
  default: vi.fn<() => React.ReactNode>(() => <div data-testid="task-detail" />),
}));
vi.mock("./views/Settings", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="settings" /> : null),
}));
vi.mock("./views/NewTaskDialog", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="new-task-dialog" /> : null),
}));
vi.mock("./views/PushDialog", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="push-dialog" /> : null),
}));
vi.mock("./views/AgentSetupDialog", () => ({
  default: vi.fn<() => React.ReactNode>(() => <div data-testid="agent-setup" />),
}));
vi.mock("./views/BootstrapWizard", () => ({
  default: vi.fn<() => React.ReactNode>(() => <div data-testid="bootstrap-wizard" />),
}));
vi.mock("./components/Sidebar", () => ({
  default: ({ onSelectTasksSegment }: { onSelectTasksSegment: () => void }) => (
    <div data-testid="app-sidebar">
      <button type="button" onClick={onSelectTasksSegment}>
        Tasks segment
      </button>
    </div>
  ),
}));
vi.mock("./components/AttentionToast", () => ({
  default: vi.fn<() => React.ReactNode>(() => <div data-testid="attention-toast" />),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), {
    custom: vi.fn<() => void>(),
    dismiss: vi.fn<() => void>(),
  }),
}));

const { useMediaQuery } = await import("./hooks/useMediaQuery");
const mockedUseMediaQuery = vi.mocked(useMediaQuery);

function setWide(wide: boolean) {
  mockedUseMediaQuery.mockReturnValue(wide);
}

/**
 * The content views are lazily imported. Under the full suite every worker
 * competes for transforms, so the import can outrun the default one-second
 * `findBy` timeout and leave the tree uncommitted — an assertion right after
 * `render` then flakes. Render, settle, then touch the DOM.
 */
async function renderApp() {
  render(<App />);
  await screen.findByTestId("mission-control", undefined, { timeout: 5_000 });
}

beforeEach(() => {
  localStorage.clear();
  useUi.setState({
    sidebarCollapsed: false,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    view: "control",
    lastTaskId: null,
    openTaskId: null,
    selectedProjectId: null,
  });
  vi.clearAllMocks();
  setWide(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App sidebar layout", () => {
  it("renders exactly one persistent sidebar on wide viewports", async () => {
    setWide(true);

    await renderApp();

    expect(screen.getByTestId("persistent-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-resize-handle")).toBeInTheDocument();
    expect(screen.getAllByTestId("app-sidebar")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Close sessions rail" })).not.toBeInTheDocument();
  });

  it("renders no sidebar on narrow viewports", async () => {
    setWide(false);

    await renderApp();

    expect(screen.queryByTestId("persistent-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-resize-handle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
  });

  it("collapsed sidebar shrinks to the icon rail and drops the resize handle", async () => {
    setWide(true);
    useUi.setState({ sidebarCollapsed: true, sidebarWidth: 400 });

    await renderApp();

    // The rail keeps its place in the split and narrows: moving it out of the
    // panel group would remount every view beside it.
    expect(screen.getByTestId("persistent-sidebar").parentElement).toHaveStyle({
      width: "56px",
    });
    expect(screen.queryByTestId("sidebar-resize-handle")).not.toBeInTheDocument();
  });

  it("⌘N opens the new task dialog", async () => {
    await renderApp();

    expect(screen.queryByTestId("new-task-dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(await screen.findByTestId("new-task-dialog")).toBeInTheDocument();
  });

  it("⌘\\ toggles the sidebar collapse", async () => {
    await renderApp();

    expect(useUi.getState().sidebarCollapsed).toBe(false);
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUi.getState().sidebarCollapsed).toBe(true);
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUi.getState().sidebarCollapsed).toBe(false);
  });
});

describe("Sidebar resize separator", () => {
  it("is a focusable separator carrying the sidebar's bounds", async () => {
    setWide(true);
    useUi.setState({ sidebarWidth: 340 });

    await renderApp();

    const handle = screen.getByTestId("sidebar-resize-handle");
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-label", "Resize sidebar");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it("clamps the store width to the sidebar bounds", () => {
    useUi.setState({ sidebarWidth: SIDEBAR_WIDTH_MIN });
    useUi.getState().setSidebarWidth(SIDEBAR_WIDTH_MIN - 100);
    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);

    useUi.getState().setSidebarWidth(SIDEBAR_WIDTH_MAX + 100);
    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
  });
});

describe("Responsive behavior", () => {
  it("hides the sidebar when viewport narrows", async () => {
    setWide(true);

    const { rerender } = render(<App />);
    await screen.findByTestId("mission-control", undefined, { timeout: 5_000 });
    expect(screen.getByTestId("persistent-sidebar")).toBeInTheDocument();

    setWide(false);
    rerender(<App />);

    expect(screen.queryByTestId("persistent-sidebar")).not.toBeInTheDocument();
  });

  it("shows the sidebar when viewport widens", async () => {
    setWide(false);

    const { rerender } = render(<App />);
    await screen.findByTestId("mission-control", undefined, { timeout: 5_000 });
    expect(screen.queryByTestId("persistent-sidebar")).not.toBeInTheDocument();

    setWide(true);
    rerender(<App />);

    expect(screen.getByTestId("persistent-sidebar")).toBeInTheDocument();
  });

  it("renders no off-canvas overlay on any viewport", async () => {
    setWide(true);

    const { rerender } = render(<App />);
    await screen.findByTestId("mission-control", undefined, { timeout: 5_000 });
    expect(screen.queryByRole("button", { name: "Close sessions rail" })).not.toBeInTheDocument();

    setWide(false);
    rerender(<App />);

    expect(screen.queryByRole("button", { name: "Close sessions rail" })).not.toBeInTheDocument();
  });
});

describe("App view branches", () => {
  it("renders the project page for the project subject", async () => {
    useUi.setState({ selectedProjectId: "warpforge", view: "project" });

    render(<App />);

    expect(
      await screen.findByTestId("projects", undefined, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });

  it("gives every global view its own branch", async () => {
    useUi.setState({ view: "inbox" });
    const { rerender } = render(<App />);
    expect(await screen.findByTestId("inbox", undefined, { timeout: 5_000 })).toBeInTheDocument();

    act(() => useUi.setState({ view: "automations" }));
    rerender(<App />);
    expect(
      await screen.findByTestId("automations", undefined, { timeout: 5_000 }),
    ).toBeInTheDocument();

    act(() => useUi.setState({ view: "control" }));
    rerender(<App />);
    expect(
      await screen.findByTestId("mission-control", undefined, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });
});

describe("Tasks segment", () => {
  it("does not resurrect a remembered task the daemon no longer has", async () => {
    // Persisted across a restart in which the task was deleted: the offer has
    // to be checked against the snapshot, not taken on trust.
    useUi.setState({ lastTaskId: "deleted-while-away", view: "inbox" });
    render(<App />);
    await screen.findByTestId("inbox", undefined, { timeout: 5_000 });

    fireEvent.click(screen.getByRole("button", { name: "Tasks segment" }));

    expect(useUi.getState().openTaskId).toBeNull();
    expect(useUi.getState().lastTaskId).toBeNull();
    expect(useUi.getState().view).toBe("control");
  });
});

describe("AppHeader sidebar control", () => {
  it("has no header sidebar toggle (collapse lives in the sidebar)", async () => {
    await renderApp();

    expect(
      screen.queryByRole("button", { name: "Toggle attention sidebar" }),
    ).not.toBeInTheDocument();
  });
});
