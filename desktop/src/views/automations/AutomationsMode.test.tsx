import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Sidebar from "@/components/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { daemon, type DaemonState } from "@/daemon";
import type { Automation, AutomationRun } from "@/protocol";
import { useUi } from "@/store/ui";
import Automations from "@/views/Automations";

const now = Math.floor(Date.now() / 1000);
const triage: Automation = {
  id: "triage",
  name: "Morning triage",
  prompt: "Summarize incoming pull requests",
  project: "warpforge",
  agent: "codex",
  model: "gpt-6.2-sol",
  trigger: { preset: "daily", cron: "0 9 * * *" },
  timezone: "UTC",
  enabled: true,
  missedRunGraceMinutes: 720,
  reuseSession: false,
  worktree: false,
  createdAt: now,
  updatedAt: now,
  nextRunAt: now + 3600,
  lastRunAt: now - 3600,
  lastStatus: "completed",
};
const audit: Automation = {
  ...triage,
  id: "audit",
  name: "Dependency audit",
  prompt: "Check package updates",
  enabled: false,
  nextRunAt: null,
  lastStatus: "failed",
};
const run: AutomationRun = {
  id: "first-run",
  automationId: triage.id,
  runNumber: 1,
  trigger: "scheduled",
  status: "completed",
  scheduledFor: now - 3600,
  startedAt: now - 3600,
  finishedAt: now - 3550,
  output: "Reviewed three pull requests.",
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
    services: [],
    tasks: [],
    terminals: [],
    projects: [
      {
        agentTemplates: {},
        declaredServices: [],
        name: "warpforge",
        path: "/workspace/warpforge",
        portRange: [4000, 4099],
      },
    ],
  },
};
const noop = () => {};

function Workspace({ collapsed }: { collapsed: boolean }) {
  const view = useUi((ui) => ui.view);
  const mode = useUi((ui) => ui.sidebarMode);
  const settingsOpen = useUi((ui) => ui.settingsOpen);
  return (
    <>
      <Sidebar
        state={state}
        collapsed={collapsed}
        mode={mode}
        view={view}
        settingsOpen={settingsOpen}
        openTaskId={null}
        onSelectMode={(next) => {
          if (next !== "tasks") useUi.getState().setView(next);
        }}
        onAddProject={noop}
        onNewTask={noop}
        onOpenProject={noop}
        onOpenTask={noop}
        onOpenSettings={useUi.getState().openSettings}
        onCloseSettings={useUi.getState().closeSettings}
        onToggleCollapsed={noop}
      />
      <main>
        {view === "automations" && !settingsOpen && (
          <Automations snapshot={state.snapshot} onOpenTask={noop} listInSidebar={!collapsed} />
        )}
      </main>
    </>
  );
}

function renderWorkspace(collapsed = false) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <Workspace collapsed={collapsed} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useUi.setState({
    view: "start",
    sidebarMode: "tasks",
    settingsOpen: false,
    selectedAutomationId: null,
  });
  vi.spyOn(daemon, "listAutomations").mockResolvedValue([triage, audit]);
  vi.spyOn(daemon, "automationRuns").mockImplementation(async (id) =>
    id === triage.id ? [run] : [],
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(useUi.getInitialState());
});

describe("Automations mode", () => {
  it("lights only Automations and lets Settings replace its panel", async () => {
    renderWorkspace();
    const rail = screen.getByRole("toolbar", { name: "Sidebar" });
    fireEvent.click(within(rail).getByRole("button", { name: "Automations" }));

    const current = rail.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Automations");
    expect(rail.querySelectorAll("[data-rail-indicator]")).toHaveLength(1);
    expect(screen.getByTestId("sidebar-panel")).toHaveAttribute("data-panel", "automations");
    expect(await screen.findByRole("list", { name: "Automations" })).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole("button", { name: "Settings" }));
    expect(rail.querySelector('[aria-current="page"]')).toHaveAccessibleName("Settings");
    expect(screen.queryByRole("list", { name: "Automations" })).not.toBeInTheDocument();
  });

  it("lists each automation and combines search, state, and outcome filters", async () => {
    useUi.getState().setView("automations");
    renderWorkspace();
    const panel = within(screen.getByTestId("sidebar-panel"));
    const enabled = await panel.findByRole("button", { name: /Morning triage/ });
    expect(enabled).toHaveTextContent(/Enabled.*Next.*Last/);
    expect(panel.getByRole("button", { name: /Dependency audit/ })).toHaveTextContent("Paused");

    const search = panel.getByRole("searchbox", { name: "Search automations" });
    fireEvent.change(search, { target: { value: "PULL REQUESTS" } });
    expect(enabled).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: /Dependency audit/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });

    fireEvent.change(panel.getByRole("combobox", { name: "Automation state" }), {
      target: { value: "paused" },
    });
    expect(enabled).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: /Dependency audit/ })).toBeInTheDocument();
    const outcome = panel.getByRole("combobox", { name: "Last run outcome" });
    fireEvent.change(outcome, { target: { value: "completed" } });
    expect(panel.getByText("No automations match these filters")).toBeInTheDocument();
    fireEvent.change(outcome, { target: { value: "failed" } });
    expect(panel.getByRole("button", { name: /Dependency audit/ })).toBeInTheDocument();
  });

  it("opens the selected schedule and returns to the overview when cleared", async () => {
    useUi.getState().setView("automations");
    renderWorkspace();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { name: "Automations overview" })).toBeInTheDocument();
    expect(main.getByRole("button", { name: "New automation" })).toBeEnabled();
    expect(await main.findByText("Next run")).toBeInTheDocument();
    expect(main.getByText("Last 24 hours")).toBeInTheDocument();
    expect(
      await main.findByRole("button", { name: "Morning triage run 1, Completed" }),
    ).toBeInTheDocument();

    const row = await screen.findByRole("button", { name: /^Morning triage Enabled/ });
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-current", "true");
    expect(main.getByRole("heading", { name: "Morning triage" })).toBeInTheDocument();
    expect(main.getByText(triage.prompt)).toBeInTheDocument();
    expect(main.getByText(triage.trigger.cron)).toBeInTheDocument();
    expect(main.getByText("gpt-6.2-sol")).toBeInTheDocument();
    expect(await main.findByRole("button", { name: /#1 Completed Reviewed/ })).toBeInTheDocument();
    for (const name of ["Run now", "Pause", "Edit", "Delete"]) {
      expect(main.getByRole("button", { name })).toBeEnabled();
    }

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(main.getByRole("heading", { name: "Automations overview" })).toBeInTheDocument();
    expect(row).not.toHaveAttribute("aria-current");
  });

  it("opens a schedule with the sidebar panel hidden", async () => {
    useUi.getState().setView("automations");
    renderWorkspace(true);
    fireEvent.click(screen.getByRole("button", { name: "Browse automations" }));
    const dialog = within(screen.getByRole("dialog", { name: "Automations" }));
    fireEvent.click(await dialog.findByRole("button", { name: /Dependency audit/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dependency audit" })).toBeInTheDocument();
  });

  it("returns to the overview when another session removes the selected schedule", async () => {
    let onEvent: Parameters<typeof daemon.subscribeEvents>[0] | undefined;
    vi.spyOn(daemon, "subscribeEvents").mockImplementation((handler) => {
      onEvent = handler;
      return noop;
    });
    useUi.getState().setView("automations");
    useUi.getState().selectAutomation(triage.id);
    renderWorkspace();
    await screen.findByRole("heading", { name: "Morning triage" });

    act(() => onEvent?.({ event: "automation.removed", data: { id: triage.id } }));
    expect(
      await screen.findByRole("heading", { name: "Automations overview" }),
    ).toBeInTheDocument();
  });
});
