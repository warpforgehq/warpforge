import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { BacklogItem } from "@/protocol";
import { smithFixture } from "@/test/smiths";

const { startSmithWork } = vi.hoisted(() => ({
  startSmithWork: vi.fn<(id: string, work: unknown) => Promise<string>>(async () => "t_new"),
}));
vi.mock("@/daemon", () => ({ daemon: { startSmithWork } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn<() => void>() } }));

import { StartWorkDialog } from "./StartWorkDialog";

const item = {
  body: "It fails one run in five.",
  id: "b_1",
  number: 12,
  project: "warpforge",
  title: "Fix the login flake",
} as BacklogItem;

describe("StartWorkDialog", () => {
  it("starts work from a board item with its text as the brief", async () => {
    const onStarted = vi.fn<(taskId: string) => void>();
    render(
      <StartWorkDialog
        open
        smith={smithFixture()}
        items={[item]}
        item={item}
        onOpenChange={vi.fn<(open: boolean) => void>()}
        onStarted={onStarted}
      />,
    );
    expect((screen.getByRole("textbox", { name: "Brief" }) as HTMLTextAreaElement).value).toContain(
      "Fix the login flake",
    );
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(startSmithWork).toHaveBeenCalledWith("sm_1", {
      backlogItemId: "b_1",
      brief: "Fix the login flake\n\nIt fails one run in five.",
      project: "warpforge",
    });
    expect(onStarted).toHaveBeenCalledWith("t_new");
  });
});
