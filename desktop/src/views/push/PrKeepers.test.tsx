import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeKeeperState } from "@/lib/keepers";
import type { KeeperEntry, KeeperRun, TaskInfo } from "@/protocol";
import { run } from "@/test/keepers";

const { client, emit, store } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: { taskKeepers: Record<string, unknown> } = { taskKeepers: {} };
  return {
    client: {
      checkReadyKeepers: vi.fn<(taskId: string) => Promise<string[]>>(),
      getState: () => state,
      listKeepers: vi.fn<() => Promise<unknown[]>>(),
      request: vi.fn<(method: string) => Promise<unknown>>(),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
    store: state,
  };
});
vi.mock("@/daemon", () => ({ daemon: client }));

import PushDialog from "../PushDialog";

const task = {
  id: "t1",
  kind: "task",
  project: "demo",
  status: "running",
  tags: [],
  worktree: "/wt",
} as unknown as TaskInfo;

const entry = (id: string, name: string, result: "draft" | "pass_fail"): KeeperEntry => ({
  definition: {
    defaultOn: true,
    id,
    maxRounds: 3,
    minSeverity: "medium",
    name,
    prompt: "",
    result,
    timeLimitSecs: 900,
    when: "ready",
  },
  id,
});

function setRuns(runs: KeeperRun[]) {
  act(() => {
    store.taskKeepers = { t1: { ...normalizeKeeperState("t1", null), runs } };
    emit();
  });
}

async function openPrForm(runs: KeeperRun[]) {
  setRuns(runs);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PushDialog open onOpenChange={() => {}} task={task} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(await screen.findByRole("button", { name: "Create PR" }));
  return user;
}

const oldDraft = run({ draft: "Old text", id: "p0", keeperId: "pr-ready", outcome: "draft" });
const fresh = (outcome: KeeperRun["outcome"], draft?: string) =>
  run({ draft, id: "p1", keeperId: "pr-ready", outcome, runNumber: 2, startedAt: 2 });

beforeEach(() => {
  vi.clearAllMocks();
  client.request.mockResolvedValue({
    branch: "feat/x",
    commits: [],
    hasUpstream: true,
    remote: "origin",
    remoteBranch: "feat/x",
    upstream: "origin/feat/x",
  });
  client.listKeepers.mockResolvedValue([
    entry("intent", "Intent", "pass_fail"),
    entry("pr-ready", "PR-ready", "draft"),
  ]);
  client.checkReadyKeepers.mockResolvedValue(["intent", "pr-ready"]);
});

describe("Create PR dialog keepers", () => {
  it("checks the ready keepers once per dialog and lists their state", async () => {
    const user = await openPrForm([oldDraft]);
    await waitFor(() => expect(client.checkReadyKeepers).toHaveBeenCalledWith("t1"));
    setRuns([oldDraft, fresh(null), run({ id: "i1", keeperId: "intent", outcome: null })]);
    const section = screen.getByRole("region", { name: "Keepers before the pull request" });
    expect(within(section).getByText("Intent").closest("li")).toHaveAttribute(
      "data-status",
      "running",
    );
    expect(screen.getByLabelText(/^Description/)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Create PR" }));
    expect(client.checkReadyKeepers).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Create Pull Request/ })).toBeEnabled();
  });

  it("fills an untouched description with PR-ready's new draft", async () => {
    await openPrForm([oldDraft]);
    await waitFor(() => expect(client.checkReadyKeepers).toHaveBeenCalled());
    setRuns([oldDraft, fresh("draft", "## TL;DR\nAdds X.")]);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Description/)).toHaveValue("## TL;DR\nAdds X."),
    );
  });

  it("never overwrites a description the owner typed", async () => {
    const user = await openPrForm([oldDraft]);
    await waitFor(() => expect(client.checkReadyKeepers).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/^Description/), "Mine");
    setRuns([oldDraft, fresh("draft", "Drafted")]);
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Mine");
  });

  it("says why the keepers did not run and still allows the PR", async () => {
    client.checkReadyKeepers.mockRejectedValue(new Error("the checkout is on main"));
    await openPrForm([]);
    expect(await screen.findByText(/Not checked: .*the checkout is on main/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Pull Request/ })).toBeEnabled();
  });
});
