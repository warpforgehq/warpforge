import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/daemon", () => ({ daemon: {} }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), { error: vi.fn<() => void>() }),
}));

import type { Conversation } from "@/lib/peerFeed";
import type { PeerMessage } from "@/protocol";

import { Thread } from "./Thread";

const label = (id: string | null | undefined) => id ?? "You";

function record(id: number): PeerMessage {
  return {
    createdAt: 100 + id,
    fromTask: "t_a",
    id,
    project: "demo",
    status: "delivered",
    text: `message ${id}`,
    toTask: "t_b",
  };
}

function pair(records: PeerMessage[], parties: [string | null, string] = ["t_a", "t_b"]) {
  return {
    key: `demo::dm::${parties.join("|")}`,
    kind: "dm",
    lastAt: 0,
    parties,
    project: "demo",
    records,
  } satisfies Conversation;
}

function show(
  conversation: Conversation,
  onMessageSession = vi.fn<(project: string, id: string) => void>(),
) {
  const props = {
    candidates: [],
    label,
    onMessageSession,
    onOpenTask: vi.fn<(id: string) => void>(),
    onStartSession: vi.fn<() => void>(),
  };
  const view = render(<Thread conversation={conversation} {...props} />);
  return {
    list: screen.getByRole("list", { name: "Messages" }),
    rerender: (next: Conversation) => view.rerender(<Thread conversation={next} {...props} />),
  };
}

function layout(list: HTMLElement, scrollHeight: number, clientHeight = 100) {
  Object.defineProperty(list, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(list, "clientHeight", { configurable: true, value: clientHeight });
}

describe("Thread", () => {
  it("offers to message either session instead of a composer between two agents", async () => {
    const onMessageSession = vi.fn<(project: string, id: string) => void>();
    show(pair([record(1)]), onMessageSession);
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Message t_b" }));
    expect(onMessageSession).toHaveBeenCalledWith("demo", "t_b");
  });

  it("has a composer in the user's own thread", () => {
    show(pair([], [null, "t_b"]));
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
  });

  it("follows new messages only while the reader is at the end", () => {
    const { list, rerender } = show(pair([record(1)]));
    layout(list, 1000);
    list.scrollTop = 300;
    fireEvent.scroll(list);
    rerender(pair([record(1), record(2)]));
    expect(list.scrollTop).toBe(300);

    list.scrollTop = 880;
    fireEvent.scroll(list);
    layout(list, 1200);
    rerender(pair([record(1), record(2), record(3)]));
    expect(list.scrollTop).toBe(1200);
  });
});
