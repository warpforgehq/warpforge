import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeKeeperState } from "@/lib/keepers";
import type { KeeperEntry, KeeperTaskState, TaskInfo } from "@/protocol";
import { finding, run } from "@/test/keepers";

const { client, store } = vi.hoisted(() => {
  const state: { taskKeepers: Record<string, unknown> } = { taskKeepers: {} };
  return {
    client: {
      addKeeper: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      checkReadyKeepers: vi.fn<(taskId: string) => Promise<string[]>>(() => Promise.resolve([])),
      decideKeeper: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      dismissKeeperFinding: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
      getState: () => state,
      listKeepers: vi.fn<() => Promise<unknown[]>>(),
      refreshTaskKeepers: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
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

const card = (name: string) => screen.findByRole("article", { name: `${name} keeper` });

beforeEach(() => {
  vi.clearAllMocks();
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
});
