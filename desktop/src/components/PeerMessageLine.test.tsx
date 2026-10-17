import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SessionUpdate } from "../protocol";
import { StreamLine } from "../views/mission-control/StreamLine";

type PeerMessage = Extract<SessionUpdate, { kind: "peer_message" }>;

const peer = (fields: Partial<PeerMessage>): PeerMessage => ({
  direction: "received",
  from_label: "Backend",
  kind: "peer_message",
  message_ids: [1],
  text: "API is ready",
  ...fields,
});

describe("peer message in the transcript", () => {
  it("opens the sender of a received message", async () => {
    const onOpenTask = vi.fn<(id: string) => void>();
    render(<StreamLine update={peer({ from_task: "t_b" })} onOpenTask={onOpenTask} />);

    expect(screen.getByText("From Backend")).toBeInTheDocument();
    expect(screen.getByText("API is ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Backend task" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_b");
  });

  it("opens the receiver of a sent message", async () => {
    const onOpenTask = vi.fn<(id: string) => void>();
    render(
      <StreamLine
        update={peer({
          direction: "sent",
          from_label: "Frontend",
          from_task: "t_f",
          to_label: "Backend",
          to_task: "t_b",
        })}
        onOpenTask={onOpenTask}
      />,
    );

    expect(screen.getByText("To Backend")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Backend task" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_b");
  });

  it("addresses a channel post to the team with nothing to open", () => {
    render(
      <StreamLine
        update={peer({ direction: "sent", from_task: "t_f" })}
        onOpenTask={vi.fn<(id: string) => void>()}
      />,
    );

    expect(screen.getByText("To team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open / })).not.toBeInTheDocument();
  });

  it("shows a digest under its own heading, clamped until expanded", async () => {
    const text = Array.from({ length: 6 }, (_, i) => `Agent ${i}: update ${i}`).join("\n");
    render(
      <StreamLine
        update={peer({ direction: "digest", from_label: "Team digest", text })}
        onOpenTask={vi.fn<(id: string) => void>()}
      />,
    );

    expect(screen.getByText("Team digest")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open / })).not.toBeInTheDocument();
    const body = screen.getByText(/Agent 0: update 0/);
    expect(body).toHaveClass("line-clamp-3");
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(body).not.toHaveClass("line-clamp-3");
  });
});
