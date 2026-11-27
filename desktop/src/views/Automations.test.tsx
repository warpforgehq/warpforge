import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { Automation, AutomationRun, Snapshot } from "@/protocol";
import { EMPTY_SNAPSHOT } from "@/protocol";
import { useUi } from "@/store/ui";

import Automations from "./Automations";

const HOUR = 3600;
const nowSecs = () => Math.floor(Date.now() / 1000);

function automation(patch: Partial<Automation> = {}): Automation {
  return {
    agent: "claude",
    createdAt: 1000,
    enabled: true,
    id: "a-1",
    missedRunGraceMinutes: 720,
    model: null,
    name: "PR triage",
    nextRunAt: nowSecs() + 2 * HOUR + 14 * 60,
    precheck: null,
    project: "warpforge",
    prompt: "Review open pull requests",
    reuseSession: false,
    timezone: "UTC",
    trigger: { cron: "0 9 * * *", preset: "daily" },
    updatedAt: 1000,
    worktree: false,
    ...patch,
  };
}

function run(patch: Partial<AutomationRun> = {}): AutomationRun {
  return {
    automationId: "a-1",
    finishedAt: nowSecs() - 3 * HOUR + 60,
    id: "r-1",
    output: "Nothing needs a human.",
    runNumber: 4,
    scheduledFor: nowSecs() - 3 * HOUR,
    startedAt: nowSecs() - 3 * HOUR,
    status: "completed",
    taskId: "t-1",
    trigger: "scheduled",
    ...patch,
  };
}

const snapshot: Snapshot = {
  ...EMPTY_SNAPSHOT,
  agents: [
    {
      acpCommand: "claude",
      displayName: "Claude",
      enabled: true,
      id: "claude",
      models: [],
    },
  ],
  projects: [
    {
      declaredServices: [],
      name: "warpforge",
      path: "/tmp/warpforge",
      portRange: [4000, 4100],
    },
  ],
};

function renderAutomations() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Automations snapshot={snapshot} onOpenTask={vi.fn<(id: string) => void>()} listInSidebar />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useUi.getState().selectAutomation(null);
  vi.restoreAllMocks();
  vi.spyOn(daemon, "listAutomations").mockResolvedValue([
    automation(),
    automation({
      enabled: false,
      id: "a-2",
      lastStatus: "failed",
      name: "Nightly deps",
      nextRunAt: null,
      prompt: "Check dependency updates",
      trigger: { cron: "0 3 * * *", preset: "daily" },
    }),
  ]);
  vi.spyOn(daemon, "automationRuns").mockImplementation(async (id) =>
    id === "a-1" ? [run()] : [],
  );
});

describe("Automations", () => {
  it("shows the next run with a countdown", async () => {
    renderAutomations();
    const strip = await screen.findByTestId("automation-live-strip");
    expect(within(strip).getByText("PR triage")).toBeInTheDocument();
    // The countdown floors, so the last whole minute has already ticked away.
    expect(strip.textContent).toMatch(/in 2h 1[34]m/);
  });

  it("pauses an automation from its detail", async () => {
    const update = vi.spyOn(daemon, "updateAutomation").mockResolvedValue(automation());
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    useUi.getState().selectAutomation("a-1");
    renderAutomations();
    await screen.findByRole("heading", { name: "PR triage" });

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(update).toHaveBeenCalledWith("a-1", { enabled: false });
  });

  it("runs an automation now without touching its schedule", async () => {
    const runNow = vi
      .spyOn(daemon, "runAutomationNow")
      .mockResolvedValue(run({ trigger: "manual" }));
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    useUi.getState().selectAutomation("a-1");
    renderAutomations();
    await screen.findByRole("heading", { name: "PR triage" });

    await user.click(screen.getByRole("button", { name: "Run now" }));
    expect(runNow).toHaveBeenCalledWith("a-1");
  });

  it("opens a run's output from the 24h timeline", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderAutomations();
    const marker = await screen.findByRole("button", { name: /PR triage run 4, Completed/ });

    await user.click(marker);
    expect(await screen.findByText("PR triage · run #4")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs a human.")).toBeInTheDocument();
  });
});
