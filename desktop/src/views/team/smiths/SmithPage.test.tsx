import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Snapshot, TaskInfo } from "@/protocol";
import { smithFixture } from "@/test/smiths";

vi.mock("@/daemon", () => ({ daemon: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn<() => void>() } }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: [], isLoading: false }),
  useQueryClient: () => ({ setQueryData: vi.fn<() => void>() }),
}));
vi.mock("./queries", () => ({
  smithDetailKey: (id: string) => ["smith", id],
  useSmithItems: () => ({ items: [], loading: false }),
}));
vi.mock("../../task-detail/TaskConversation", () => ({
  TaskConversation: ({ task }: { task: TaskInfo }) => <div data-testid="chat">{task.id}</div>,
}));

import { SmithPage } from "./SmithPage";

const thread = {
  agent: "claude",
  createdAt: 1,
  id: "t_thread",
  origin: "smith",
  project: "warpforge",
  prompt: "",
  smithId: "sm_1",
  status: "waiting",
  tags: [],
  title: "",
  updatedAt: 1,
} as unknown as TaskInfo;
const snapshot = { agents: [], projects: [], tasks: [thread] } as unknown as Snapshot;

function show(injection?: "system_prompt" | "prefix") {
  render(
    <SmithPage
      smith={smithFixture({ injection })}
      snapshot={snapshot}
      onOpenTask={vi.fn<(id: string) => void>()}
      onEdit={vi.fn<() => void>()}
      onDeleted={vi.fn<() => void>()}
    />,
  );
}

describe("SmithPage", () => {
  it("talks to the teammate in its thread task's own chat, in the page", () => {
    show();
    expect(screen.getByTestId("chat").textContent).toBe("t_thread");
    expect(screen.queryByRole("button", { name: /Open chat/ })).toBeNull();
  });

  it("says how the soul is delivered when the daemon tells it", () => {
    show("prefix");
    expect(screen.getByText(/install claude-agent-acp 0.91/)).toBeTruthy();
  });
});
