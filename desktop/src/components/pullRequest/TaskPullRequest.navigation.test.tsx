import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import * as clipboard from "@/lib/clipboard";
import * as links from "@/lib/externalLinks";
import { isInboxEntryUnseen } from "@/lib/inboxSeen";
import type { PullRequestSummary, TaskInfo, TaskPullRequest } from "@/protocol";
import { useUi } from "@/store/ui";

import { PullRequestTaskLink } from "./PullRequestTaskLink";
import { TaskPullRequestChip } from "./TaskPullRequestChip";
import { TaskPullRequestGlyph } from "./TaskPullRequestGlyph";
import { TaskPullRequestSurface } from "./TaskPullRequestSurface";

vi.mock("@/components/inbox/InboxDetailPane", () => ({
  InboxDetailPane: ({ pr }: { pr: { repo: string; number: number } }) => (
    <div>
      {pr.repo}#{pr.number}
    </div>
  ),
}));
const task = {
  id: "navigation-task",
  project: "widgets",
  agent: "codex",
  tags: [],
} as unknown as TaskInfo;
const pr: TaskPullRequest = {
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  title: "Change",
  state: "open",
};
function summary(overrides: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    project: "demo",
    repo: "acme/widgets",
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: "open",
    draft: false,
    labels: [],
    assignees: [],
    baseRefName: "main",
    headRefName: "feat/change",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
function setup() {
  vi.spyOn(daemon, "getState").mockReturnValue({
    ...daemon.getState(),
    taskPullRequests: { [task.id]: pr },
  });
  vi.spyOn(daemon, "refreshTaskPullRequests").mockResolvedValue();
  useUi.setState({ openTaskId: task.id, activeSurface: "diff", showDiff: false });
}
afterEach(() => vi.restoreAllMocks());
it("opens the chip in Warpforge, with modifier and arrow escapes to GitHub", () => {
  setup();
  const external = vi.spyOn(links, "openExternalLink").mockResolvedValue();
  render(<TaskPullRequestChip task={task} />);
  const body = screen.getByRole("button", { name: /open in Warpforge/ });
  fireEvent.click(body);
  expect(useUi.getState()).toMatchObject({ activeSurface: "pull-request", showDiff: true });
  fireEvent.click(body, { metaKey: true });
  fireEvent.click(body, { ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Open on GitHub" }));
  expect(external.mock.calls).toEqual([[pr.url], [pr.url], [pr.url]]);
});
it("offers the three context menu actions", () => {
  setup();
  const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue(true);
  render(<TaskPullRequestChip task={task} />);
  fireEvent.contextMenu(screen.getByRole("button", { name: /open in Warpforge/ }));
  expect(screen.getByRole("menuitem", { name: "Open in Warpforge" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Open on GitHub" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
  expect(copy).toHaveBeenCalledWith(pr.url, "pull request link");
});
it("opens the glyph without selecting its parent row", () => {
  setup();
  useUi.setState({ openTaskId: "other-task" });
  const row = vi.fn<() => void>();
  render(
    <div onClick={row}>
      <TaskPullRequestGlyph taskId={task.id} receded={false} />
    </div>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(row).not.toHaveBeenCalled();
  expect(useUi.getState().activeSurface).toBe("pull-request");
});
it("opens the exact task PR without fetching the filtered inbox and marks it seen", async () => {
  setup();
  useUi.setState({
    inboxFilters: { assignedToMe: true, scope: "review", state: "open", search: "excluded-pr" },
  });
  const list = vi.spyOn(daemon, "listPulls");
  vi.spyOn(daemon, "pullDetails").mockResolvedValue({
    ...pr,
    author: null,
    draft: false,
    body: "",
    baseRefName: "main",
    headRefName: "feature",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    updatedAt: 123,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskPullRequestSurface task={task} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("acme/widgets#42")).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
  expect(isInboxEntryUnseen({ key: "acme/widgets#42", updatedAt: 123 })).toBe(false);
});
it("returns from a PR to its owning task", () => {
  setup();
  useUi.setState({ openTaskId: "other-task" });
  render(<PullRequestTaskLink pr={summary({})} />);
  fireEvent.click(screen.getByText("→ task"));
  expect(useUi.getState()).toMatchObject({ openTaskId: task.id, activeSurface: "pull-request" });
});

it("renders compact status without archive controls or another refresh", () => {
  setup();
  const refresh = vi.mocked(daemon.refreshTaskPullRequests);
  vi.mocked(daemon.getState).mockReturnValue({
    ...daemon.getState(),
    taskPullRequests: { [task.id]: { ...pr, state: "merged" } },
  });
  const withWorktree = { ...task, title: "Change", prompt: "Change", worktree: "/worktree" };
  render(
    <>
      <TaskPullRequestChip task={withWorktree} />
      <TaskPullRequestChip task={withWorktree} compact />
    </>,
  );
  expect(screen.getAllByRole("button", { name: "Archive and remove worktree" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: /open in Warpforge/ })).toHaveLength(2);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it.each(["Enter", " "])("honours modifiers on %s for chip and glyph", async (key) => {
  setup();
  const external = vi.spyOn(links, "openExternalLink").mockResolvedValue();
  render(
    <>
      <TaskPullRequestChip task={task} />
      <TaskPullRequestGlyph taskId={task.id} receded={false} />
    </>,
  );
  for (const button of screen
    .getAllByRole("button")
    .filter((el) => el.hasAttribute("data-task-pr"))) {
    button.focus();
    await userEvent.keyboard("{Meta>}" + (key === "Enter" ? "{Enter}" : " ") + "{/Meta}");
  }
  expect(external.mock.calls).toEqual([[pr.url], [pr.url]]);
  expect(useUi.getState().activeSurface).toBe("diff");
});

it("matches an owning task URL regardless of case", () => {
  setup();
  render(
    <PullRequestTaskLink pr={summary({ url: pr.url.toUpperCase(), repo: "elsewhere/repo" })} />,
  );
  expect(screen.getByText("→ task")).toBeInTheDocument();
});

it.each(["Shift", "Alt"])("keeps %s clicks inside Warpforge", async (modifier) => {
  setup();
  const external = vi.spyOn(links, "openExternalLink").mockResolvedValue();
  render(<TaskPullRequestGlyph taskId={task.id} receded={false} />);
  const user = userEvent.setup();
  await user.keyboard(`{${modifier}>}`);
  await user.click(screen.getByRole("button"));
  await user.keyboard(`{/${modifier}}`);
  expect(external).not.toHaveBeenCalled();
  expect(useUi.getState().activeSurface).toBe("pull-request");
});
