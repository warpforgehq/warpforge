import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RowActions } from "@/components/Sidebar/TaskRowActions";
import type { TaskInfo } from "@/protocol";

vi.mock("@/daemon", () => ({
  daemon: {
    archiveTask: vi.fn<(id: string) => Promise<void>>(),
    deleteTask: vi.fn<(id: string) => Promise<void>>(),
    getState: () => ({ taskPullRequests: {} }),
    request: vi.fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>(),
    subscribe: () => () => {},
  },
}));

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id: "t1",
    parentTaskId: null,
    project: "warpforge",
    prompt: "Ship it",
    status: "waiting",
    tags: [],
    title: "",
    updatedAt: 1,
    ...overrides,
  };
}

describe("TaskRowActions", () => {
  it("keeps the action lane displayed while its menu is open", async () => {
    const user = userEvent.setup();
    render(
      <RowActions task={task()} state="idle" pinned={false} factory={false} onPin={() => {}} />,
    );

    const trigger = screen.getByRole("button", { name: /Task actions/ });
    const container = trigger.parentElement!;

    // Resting: the lane is out of the box but armed to stay while a menu opens.
    expect(container.className).toContain("hidden");
    expect(container.className).toContain("has-[[data-state=open]]:flex");
    expect(container.className).toContain("has-[[data-state=open]]:pointer-events-auto");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("data-state", "open");
    expect(container.className).toContain("has-[[data-state=open]]:flex");
  });

  it("keeps the snooze lane displayed while the snooze menu is open", async () => {
    const user = userEvent.setup();
    render(
      <RowActions task={task()} state="idle" pinned={false} factory={false} onPin={() => {}} />,
    );

    const trigger = screen.getByRole("button", { name: /Remind later/ });
    const container = trigger.parentElement!;

    await user.click(trigger);

    expect(trigger).toHaveAttribute("data-state", "open");
    expect(container.className).toContain("has-[[data-state=open]]:flex");
  });
});
