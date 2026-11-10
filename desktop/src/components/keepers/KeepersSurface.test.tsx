import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DaemonRpcError } from "@/daemon/rpcError";
import { normalizeKeeperState } from "@/lib/keepers";
import type { AgentConfig, KeeperEntry, KeeperTaskState, TaskInfo } from "@/protocol";
import { finding, run } from "@/test/keepers";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn<(...args: unknown[]) => void>() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const { client, store } = vi.hoisted(() => {
  const state: { snapshot: { agents: unknown[] }; taskKeepers: Record<string, unknown> } = {
    snapshot: { agents: [] },
    taskKeepers: {},
  };
  return {
    client: {
      acceptKeeperReply: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      addKeeper: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      checkReadyKeepers: vi.fn<
        (taskId: string) => Promise<{ head: string | null; started: string[] }>
      >(() => Promise.resolve({ head: null, started: [] })),
      decideKeeper: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      dismissKeeperFinding: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      getState: () => state,
      listKeepers: vi.fn<() => Promise<unknown[]>>(),
      refreshTaskKeepers: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      saveKeeperRunsOn: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      sendKeeperFindings: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      setKeeperSwitch: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      subscribe: () => () => {},
    },
    store: state,
  };
});
vi.mock("@/daemon", () => ({ daemon: client }));

import { KeepersSurface } from "./KeepersSurface";

const task = { id: "t1", project: "demo", tags: [], worktree: "/wt" } as unknown as TaskInfo;

const entry = (id: string, fields: Partial<KeeperEntry["definition"]> = {}): KeeperEntry => ({
  definition: {
    defaultOn: true,
    id,
    maxRounds: 3,
    minSeverity: "medium",
    name: id.charAt(0).toUpperCase() + id.slice(1),
    prompt: "",
    result: "findings",
    timeLimitSecs: 900,
    when: "commit",
    ...fields,
  },
  id,
});

function show(entries: KeeperEntry[], state?: Partial<KeeperTaskState>, of: TaskInfo = task) {
  client.listKeepers.mockResolvedValue(entries);
  store.taskKeepers = state ? { t1: { ...normalizeKeeperState("t1", null), ...state } } : {};
  const onOpenFile = vi.fn<(path: string, location?: { line?: number }) => void>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <KeepersSurface task={of} onOpenFile={onOpenFile} />
    </QueryClientProvider>,
  );
  return { onOpenFile, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const agent = (id: string, models: AgentConfig["models"]): AgentConfig => ({
  acpCommand: id,
  displayName: id,
  enabled: true,
  id,
  models,
});

const agents = [
  agent("claude", [
    { currentValue: "", id: "model", name: "Model", options: [{ name: "Opus", value: "opus" }] },
    {
      currentValue: "",
      id: "effort",
      name: "Effort",
      options: [{ name: "High", value: "high" }],
    },
  ]),
  agent("opencode", [
    {
      currentValue: "",
      id: "model",
      name: "Model",
      options: [{ name: "Flash", value: "opencode-go/deepseek-v4.1-flash" }],
    },
  ]),
];

const card = (name: string) => screen.findByRole("article", { name: `${name} keeper` });

beforeEach(() => {
  vi.clearAllMocks();
  store.snapshot.agents = [];
});

describe("KeepersSurface", () => {
  it("offers the presets when the project has no keepers and writes the picked one", async () => {
    const { user } = show([]);
    expect(await screen.findByText("No keepers yet")).toBeInTheDocument();
    expect(client.refreshTaskKeepers).toHaveBeenCalledWith("t1");
    await user.click(screen.getByRole("button", { name: /Add keeper/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Slop/ }));
    await waitFor(() => expect(client.addKeeper).toHaveBeenCalledWith("demo", "slop"));
  });

  it("shows each state: off, running, green, waiting with its reason", async () => {
    show([entry("review"), entry("slop"), entry("conventions"), entry("intent")], {
      loops: {
        intent: {
          maxRounds: 3,
          reason: "the worktree has uncommitted changes",
          rounds: 1,
          status: "waiting",
        },
      },
      runs: [
        run({ id: "r1", keeperId: "slop", outcome: null }),
        run({ id: "r2", keeperId: "conventions" }),
        run({ id: "r3", keeperId: "intent", count: 1, outcome: "findings" }),
      ],
      switches: { overrides: { review: false } },
    });
    expect(await card("Review")).toHaveAttribute("data-status", "off");
    expect(await card("Slop")).toHaveAttribute("data-status", "running");
    expect(await card("Conventions")).toHaveAttribute("data-status", "green");
    const intent = await card("Intent");
    expect(intent).toHaveAttribute("data-status", "waiting");
    expect(within(intent).getByText(/uncommitted changes/)).toBeInTheDocument();
  });

  it("draws the last ten runs: green, red with the count, grey", async () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      run({ id: `r${i}`, runNumber: i + 1, startedAt: i, outcome: "green" }),
    );
    runs[10] = run({ count: 4, id: "r10", outcome: "findings", runNumber: 11, startedAt: 10 });
    runs[11] = run({ id: "r11", outcome: "inconclusive", runNumber: 12, startedAt: 11 });
    show([entry("review")], { runs });
    const strip = within(await card("Review")).getByRole("list", { name: "Last runs" });
    const cells = within(strip).getAllByRole("listitem");
    expect(cells).toHaveLength(10);
    expect(cells.map((cell) => cell.dataset.tone)).toEqual([
      ...Array(8).fill("green"),
      "red",
      "grey",
    ]);
    expect(cells[8]).toHaveTextContent("4");
  });

  it("names the branch a folder task owns and why its keepers are paused", async () => {
    const folder = { ...task, worktree: null } as unknown as TaskInfo;
    show(
      [entry("review")],
      {
        switches: { branch: "feat/x", held: "the checkout is on main, not feat/x", overrides: {} },
      },
      folder,
    );
    expect(await screen.findByText("Checks each commit on feat/x.")).toBeInTheDocument();
    expect(screen.getByText("Paused: the checkout is on main, not feat/x.")).toBeInTheDocument();
  });

  it("switches a keeper for this task", async () => {
    const { user } = show([entry("review")]);
    await user.click(within(await card("Review")).getByRole("switch"));
    expect(client.setKeeperSwitch).toHaveBeenCalledWith("t1", "review", false);
  });

  it("lists findings with precision, opens file:line and dismisses with a reason", async () => {
    const { onOpenFile, user } = show([entry("review")], {
      findings: [finding({ file: "src/a.rs", id: "f1", line: 12, runId: "r1", severity: "high" })],
      precision: [{ dismissed: 1, fixed: 3, keeperId: "review" }],
      runs: [run({ count: 1, id: "r1", outcome: "findings" })],
    });
    const review = await card("Review");
    expect(within(review).getByText("Precision 75% of 4 resolved")).toBeInTheDocument();
    expect(within(review).getByText("high")).toBeInTheDocument();
    await user.click(within(review).getByRole("button", { name: "src/a.rs:12" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/a.rs", { line: 12 });

    await user.click(within(review).getByRole("button", { name: "Dismiss" }));
    await user.type(within(review).getByLabelText("Why dismiss (optional)"), "intended");
    await user.click(within(review).getByRole("button", { name: "Dismiss" }));
    expect(client.dismissKeeperFinding).toHaveBeenCalledWith("t1", "f1", "intended");
  });

  it("sends open findings to the agent and toasts the daemon's refusal", async () => {
    client.sendKeeperFindings.mockRejectedValueOnce(
      new DaemonRpcError("invalid_request", "the task's agent is working"),
    );
    const { user } = show([entry("review")], {
      findings: [finding({ id: "f1", runId: "r1" })],
      runs: [run({ count: 1, id: "r1", outcome: "findings" })],
    });
    await user.click(within(await card("Review")).getByRole("button", { name: "Send to agent" }));
    expect(client.sendKeeperFindings).toHaveBeenCalledWith("t1", "review");
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not send the findings", {
        description: "the task's agent is working",
      }),
    );
  });

  it("offers Send to agent only for open findings while the keeper is not fixing", async () => {
    const runs = [run({ count: 1, id: "r1", outcome: "findings" })];
    show([entry("review")], { findings: [finding({ id: "f1", status: "sent" })], runs });
    expect(within(await card("Review")).getByText("Off by one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to agent" })).not.toBeInTheDocument();
    cleanup();
    show([entry("review")], {
      findings: [finding({ id: "f1" })],
      loops: { review: { maxRounds: 3, rounds: 1, status: "fixing" } },
      runs,
    });
    expect(within(await card("Review")).getByText("Off by one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to agent" })).not.toBeInTheDocument();
  });

  it("shows the agent's answer with Accept only on a finding it answered", async () => {
    client.acceptKeeperReply.mockRejectedValueOnce(
      new DaemonRpcError("invalid_request", "that finding is already resolved"),
    );
    const { user } = show([entry("review")], {
      findings: [
        finding({
          id: "f1",
          reply: { reason: "the caller validates it", verdict: "rebutted" },
          status: "sent",
        }),
        finding({ id: "f2", status: "sent" }),
      ],
      runs: [run({ count: 2, id: "r1", outcome: "findings" })],
    });
    const review = await card("Review");
    expect(
      within(review).getByText("Agent: rebutted — the caller validates it"),
    ).toBeInTheDocument();
    expect(within(review).getAllByRole("button", { name: "Accept" })).toHaveLength(1);
    expect(within(review).getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);
    expect(within(review).queryByRole("button", { name: "Accept all" })).not.toBeInTheDocument();
    await user.click(within(review).getByRole("button", { name: "Accept" }));
    expect(client.acceptKeeperReply).toHaveBeenCalledWith("t1", "f1");
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not accept the agent's answer", {
        description: "that finding is already resolved",
      }),
    );
  });

  it("accepts every answer at once and lets Send to agent re-send them", async () => {
    const { user } = show([entry("review")], {
      findings: [
        finding({ id: "f1", reply: { reason: "intended", verdict: "rebutted" }, status: "sent" }),
        finding({ id: "f2", reply: { reason: "fixed in abc", verdict: "stale" }, status: "sent" }),
      ],
      runs: [run({ count: 2, id: "r1", outcome: "findings" })],
    });
    const review = await card("Review");
    expect(within(review).getByText("Agent: no longer holds — fixed in abc")).toBeInTheDocument();
    expect(within(review).getByRole("button", { name: "Send to agent" })).toBeInTheDocument();
    await user.click(within(review).getByRole("button", { name: "Accept all" }));
    expect(client.acceptKeeperReply.mock.calls).toEqual([
      ["t1", "f1"],
      ["t1", "f2"],
    ]);
  });

  it("asks the owner when the loop stopped: extend, accept or off", async () => {
    const { user } = show([entry("review")], {
      loops: { review: { maxRounds: 3, rounds: 3, status: "needs_you", stop: "max_rounds" } },
      runs: [run({ count: 2, id: "r1", outcome: "findings" })],
    });
    const choice = within(await card("Review")).getByRole("region", { name: "Keeper needs you" });
    expect(choice).toHaveTextContent("used its fix rounds after 3 of 3 rounds");

    await user.click(within(choice).getByRole("button", { name: "Accept" }));
    expect(client.decideKeeper).toHaveBeenCalledWith("t1", "review", "accept", undefined);
    await user.click(within(choice).getByRole("button", { name: "Off for this task" }));
    expect(client.decideKeeper).toHaveBeenCalledWith("t1", "review", "off", undefined);

    await user.click(within(choice).getByRole("button", { name: "Extend…" }));
    await user.type(within(choice).getByLabelText("Guidance for the fix (optional)"), "keep API");
    await user.click(within(choice).getByRole("button", { name: "Extend" }));
    expect(client.decideKeeper).toHaveBeenCalledWith("t1", "review", "extend", {
      note: "keep API",
      rounds: 2,
    });
  });

  it("shows a file's parse error and warnings", async () => {
    show([
      entry("review"),
      { error: "unknown result `score`", id: "broken" },
      { ...entry("slop"), warnings: ["unknown key `colour`"] },
    ]);
    const problems = await screen.findByRole("list", { name: "Keeper file problems" });
    expect(problems).toHaveTextContent("unknown result `score`");
    expect(problems).toHaveTextContent("unknown key `colour`");
    expect(screen.queryByRole("article", { name: "broken keeper" })).toBeNull();
  });

  it("groups the presets by when they run", async () => {
    const { user } = show([]);
    await user.click(await screen.findByRole("button", { name: /Add keeper/ }));
    const menu = await screen.findByRole("menu");
    expect(menu.textContent).toMatch(
      /On every commit.*Review.*Slop.*Conventions.*Before the pull request.*Security.*Thermonuclear.*Intent.*Verify.*PR-ready/,
    );
    await user.click(within(menu).getByRole("menuitem", { name: /PR-ready/ }));
    await waitFor(() => expect(client.addKeeper).toHaveBeenCalledWith("demo", "pr-ready"));
  });

  it("says a ready keeper waits for Check before PR, then shows its draft without a verdict", async () => {
    const ready = entry("pr-ready", { name: "PR-ready", result: "draft", when: "ready" });
    show([ready]);
    const before = await card("PR-ready");
    expect(within(before).getByText(/runs when you check before the pull request/)).toBeVisible();
    cleanup();

    show([ready], {
      runs: [run({ draft: "## TL;DR\nAdds X.", id: "d1", keeperId: "pr-ready", outcome: "draft" })],
    });
    const after = await card("PR-ready");
    expect(after).toHaveAttribute("data-status", "draft");
    expect(within(after).getByText("Draft ready")).toBeInTheDocument();
    expect(within(after).getByText("Checks before PR")).toBeInTheDocument();
    expect(within(after).getByRole("region", { name: "PR-ready draft" })).toHaveTextContent(
      "Adds X.",
    );
    expect(within(after).getByRole("button", { name: "Copy draft" })).toBeInTheDocument();
    expect(within(after).getAllByRole("listitem")[0]?.dataset.tone).toBe("grey");
  });

  it("checks the ready keepers before the PR and waits while one runs", async () => {
    const ready = entry("intent", { when: "ready" });
    const { user } = show([entry("review"), ready]);
    await user.click(await screen.findByRole("button", { name: "Check before PR" }));
    expect(client.checkReadyKeepers).toHaveBeenCalledWith("t1");
    cleanup();

    show([ready], { runs: [run({ id: "i1", keeperId: "intent", outcome: null })] });
    expect(await screen.findByRole("button", { name: "Check before PR" })).toBeDisabled();
  });

  it("offers no Check before PR without a ready keeper", async () => {
    show([entry("review")]);
    await card("Review");
    expect(screen.queryByRole("button", { name: "Check before PR" })).toBeNull();
  });

  it("shows the task's agent when a keeper names no harness", async () => {
    show([entry("review")]);
    const review = await card("Review");
    expect(within(review).getByRole("button", { name: "Runs on Task's agent" })).toBeVisible();
  });

  it("sets a keeper's harness, model and effort from its card", async () => {
    store.snapshot.agents = agents;
    const { user } = show([
      entry("slop", { agent: "opencode", model: "opencode-go/deepseek-v4.1-flash" }),
    ]);
    const slop = await card("Slop");
    await user.click(within(slop).getByRole("button", { name: "Runs on opencode · Flash" }));
    expect(screen.queryByRole("combobox", { name: "Effort" })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Harness" }), "claude");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("");
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "opus");
    await user.selectOptions(screen.getByRole("combobox", { name: "Effort" }), "high");
    const listed = client.listKeepers.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(client.saveKeeperRunsOn).toHaveBeenCalledWith("demo", "slop", {
      agent: "claude",
      effort: "high",
      model: "opus",
    });
    await waitFor(() => expect(client.listKeepers.mock.calls.length).toBeGreaterThan(listed));
    expect(screen.queryByRole("combobox", { name: "Harness" })).toBeNull();
  });

  it("unsets everything when the harness goes back to the task's agent", async () => {
    store.snapshot.agents = agents;
    const { user } = show([entry("review", { agent: "claude", effort: "high", model: "opus" })]);
    await user.click(
      within(await card("Review")).getByRole("button", { name: "Runs on claude · Opus" }),
    );
    expect(screen.getByRole("combobox", { name: "Effort" })).toHaveValue("high");
    await user.selectOptions(screen.getByRole("combobox", { name: "Harness" }), "");
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(client.saveKeeperRunsOn).toHaveBeenCalledWith("demo", "review", { agent: undefined });
  });
});
