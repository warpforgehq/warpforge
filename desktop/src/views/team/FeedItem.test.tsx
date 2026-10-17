import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PeerMessage } from "@/protocol";

import { FeedItem } from "./FeedItem";

const label = (id: string | null | undefined) =>
  id ? (({ t_a: "Fix login", t_b: "Docs" } as Record<string, string>)[id] ?? id) : "You";

function record(overrides: Partial<PeerMessage>): PeerMessage {
  return {
    createdAt: 1_700_000_000,
    fromTask: "t_a",
    id: 7,
    project: "demo",
    status: "delivered",
    text: "can you review?",
    toTask: "t_b",
    ...overrides,
  };
}

function show(item: PeerMessage, onStartSession = vi.fn()) {
  const onOpenTask = vi.fn();
  render(
    <ul>
      <FeedItem
        record={item}
        label={label}
        onOpenTask={onOpenTask}
        onStartSession={onStartSession}
      />
    </ul>,
  );
  return { onOpenTask, onStartSession };
}

describe("FeedItem", () => {
  it("shows a refusal with its reason and opens either session", async () => {
    const { onOpenTask } = show(record({ reason: "pair window is full", status: "refused" }));
    expect(screen.getByText("Refused")).toBeTruthy();
    expect(screen.getByText("pair window is full")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_b");
  });

  it("explains a held message", () => {
    show(record({ status: "held" }));
    expect(screen.getByText(/not running/)).toBeTruthy();
  });

  it("offers to start a session from the user's own post only", async () => {
    const post = record({ fromTask: undefined, status: "posted", toTask: undefined });
    const { onStartSession } = show(post);
    await userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(onStartSession).toHaveBeenCalledWith(post);
  });

  it("has no start action on an agent's post", () => {
    show(record({ status: "posted", toTask: undefined }));
    expect(screen.queryByRole("button", { name: "Start a session" })).toBeNull();
  });

  it("lists who a user's post was handed to", async () => {
    const { onOpenTask } = show(
      record({ fromTask: undefined, mentions: ["t_b"], status: "posted", toTask: undefined }),
    );
    expect(screen.getByText("Handed to")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_b");
  });

  it("renders a started line with a link to the new session", async () => {
    const { onOpenTask } = show(
      record({ fromTask: undefined, startedTask: "t_a", status: "posted", toTask: undefined }),
    );
    expect(screen.getByText("You started")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Fix login" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_a");
  });
});
