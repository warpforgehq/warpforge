import { render, screen } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { GitPushInfo } from "@/protocol";

import { PushFooter } from "./PushFooter";

const info: GitPushInfo = {
  branch: "feature",
  remote: "origin",
  remoteBranch: "feature",
  upstream: "origin/feature",
  hasUpstream: false,
  commits: [{ hash: "abc", shortHash: "abc", subject: "Feature", author: "Dev", files: [] }],
};

function footer(overrides: Partial<React.ComponentProps<typeof PushFooter>> = {}) {
  const onPush = vi.fn<(force: boolean) => void>();
  const result = render(
    <PushFooter
      info={info}
      loading={false}
      pushing={false}
      repositoryOperation={null}
      onCreatePr={() => {}}
      onPush={onPush}
      {...overrides}
    />,
  );
  return { ...result, onPush };
}

describe("PushFooter", () => {
  it("puts outgoing count in Push and upstream information only in its tooltip", () => {
    footer();
    expect(screen.getByRole("button", { name: "Push ↑1" })).toHaveAttribute(
      "title",
      "First push will create upstream origin/feature.",
    );
    expect(screen.queryByText(/First push/)).not.toBeInTheDocument();
  });

  it("shows disabled Up to date when the upstream has every commit", () => {
    footer({ info: { ...info, hasUpstream: true, commits: [] } });
    expect(screen.getByRole("button", { name: "Up to date" })).toBeDisabled();
    expect(screen.queryByText("↑0")).not.toBeInTheDocument();
  });

  it("allows the first push even without outgoing commits", () => {
    footer({ info: { ...info, commits: [] } });
    expect(screen.getByRole("button", { name: "Push" })).toBeEnabled();
  });

  it("hides Create PR for existing PRs", () => {
    footer({ hasPr: true });
    expect(screen.queryByRole("button", { name: "Create PR" })).not.toBeInTheDocument();
  });

  it("retains the disabled PR reason", () => {
    footer({ createPrDisabledReason: "Switch to a feature branch" });
    expect(screen.getByRole("button", { name: "Create PR" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create PR" })).toHaveAttribute(
      "title",
      "Switch to a feature branch",
    );
  });

  it("closes its menu on outside click and Escape, and force pushes on selection", async () => {
    // Radix modal menus suppress body pointer events; dispatch the outside
    // pointer explicitly, as a browser click outside the menu would.
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const { onPush } = footer();
    const trigger = screen.getByRole("button", { name: "Push options" });
    await user.click(trigger);
    expect(screen.getByRole("menuitem")).toHaveTextContent("Force push (force-with-lease)");
    await user.click(document.body);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem"));
    expect(onPush).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("disables both push controls during repository operations", () => {
    footer({ repositoryOperation: { kind: "push", taskId: "other" } });
    expect(screen.getByRole("button", { name: "Push ↑1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Push options" })).toBeDisabled();
  });
});
