import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueuedPrompt } from "@/protocol";

const { request, toastError } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  toastError: vi.fn<(message: string) => void>(),
}));
vi.mock("@/daemon", () => ({ daemon: { request } }));
vi.mock("../../daemon", () => ({ daemon: { request } }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { QueuedPromptsBar } from "./QueuedPromptsBar";

const waiting = (id: string, text: string, initiator: QueuedPrompt["initiator"] = "user") => ({
  id,
  initiator,
  text,
});

describe("QueuedPromptsBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    request.mockResolvedValue(undefined);
  });

  it("shows nothing when no message is waiting", () => {
    const { container } = render(<QueuedPromptsBar taskId="t1" queued={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every waiting message in full, in order", () => {
    render(
      <QueuedPromptsBar
        taskId="t1"
        queued={[waiting("q1", "rebase onto main"), waiting("q2", "and run the tests")]}
      />,
    );
    expect(screen.getByText("2 messages waiting for the agent")).toBeInTheDocument();
    const texts = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(texts).toEqual(["rebase onto main", "and run the tests"]);
  });

  it("names the sender of a message nobody typed", () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "nightly", "automation")]} />);
    expect(screen.getByText("Scheduled run")).toBeInTheDocument();
  });

  it("sends the whole queue now", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "a"), waiting("q2", "b")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Send all now" }));
    expect(request).toHaveBeenCalledWith("session.interrupt", { task_id: "t1" });
  });

  it("surfaces a refusal instead of looking like a dead button", async () => {
    request.mockRejectedValue(new Error("nothing is waiting to be sent"));
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "a")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(toastError).toHaveBeenCalledWith("nothing is waiting to be sent");
  });
});
