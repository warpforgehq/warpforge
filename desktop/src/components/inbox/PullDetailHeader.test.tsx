import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PullRequestDetails, PullRequestSummary } from "@/protocol";

import { PullDetailHeader } from "./PullDetailHeader";

const pr: PullRequestSummary = {
  project: "warpforge",
  repo: "acme/widgets",
  number: 466,
  title: "Add widget",
  url: "https://github.test/pull/466",
  state: "open",
  draft: false,
  labels: [],
  assignees: [],
  baseRefName: "main",
  headRefName: "widget",
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};

const details: PullRequestDetails = {
  title: "Add widget",
  url: "https://github.test/pull/466",
  state: "open",
  draft: false,
  body: "",
  baseRefName: "main",
  headRefName: "fix/elt-agent-harness-cube",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
};

function stubClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

function renderHeader() {
  return render(
    <PullDetailHeader pr={pr} details={details} refreshing={false} onRefresh={() => {}} />,
  );
}

describe("PullDetailHeader", () => {
  it("hangs the actions off the pull request reference", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "acme/widgets#466" }));
    expect(await screen.findByRole("menuitem", { name: "Copy GitHub URL" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy branch name" })).toBeInTheDocument();
  });

  it("copies the branch name", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "acme/widgets#466" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy branch name" }));

    expect(writeText).toHaveBeenCalledWith("fix/elt-agent-harness-cube");
  });

  it("copies the title as a Markdown link", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "acme/widgets#466" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy title as link" }));

    expect(writeText).toHaveBeenCalledWith("[Add widget](https://github.test/pull/466)");
  });
});
