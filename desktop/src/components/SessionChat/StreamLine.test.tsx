import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionUpdate } from "../../protocol";
import { StreamLine } from "./StreamLine";

const { answerPermission } = vi.hoisted(() => ({
  answerPermission:
    vi.fn<(taskId: string, requestId: string, outcome: string) => Promise<boolean>>(),
}));
vi.mock("@/lib/answerPermission", () => ({ answerPermission }));

const request: SessionUpdate = {
  kind: "permission_request",
  options: ["allow", "deny"],
  request_id: "req-1",
  title: "Run the tests",
};

describe("StreamLine permission prompt", () => {
  afterEach(() => answerPermission.mockReset());

  it("offers the prompt again when the answer failed", async () => {
    answerPermission.mockResolvedValue(false);
    render(<StreamLine update={request} taskId="t_1" resolved={{}} />);

    await userEvent.click(screen.getByRole("button", { name: "allow" }));

    expect(answerPermission).toHaveBeenCalledWith("t_1", "req-1", "allow");
    expect(await screen.findByRole("button", { name: "allow" })).toBeInTheDocument();
  });

  it("shows the outcome the daemon recorded over the local click", async () => {
    answerPermission.mockResolvedValue(true);
    const { rerender } = render(<StreamLine update={request} taskId="t_1" resolved={{}} />);

    await userEvent.click(screen.getByRole("button", { name: "allow" }));
    expect(screen.getByText("✓ allow")).toBeInTheDocument();

    rerender(<StreamLine update={request} taskId="t_1" resolved={{ "req-1": "deny" }} />);
    expect(screen.getByText("✓ deny")).toBeInTheDocument();
  });

  it("offers no answers for a cancelled request", () => {
    render(<StreamLine update={request} taskId="t_1" resolved={{ "req-1": "cancelled" }} />);

    expect(screen.queryByRole("button", { name: "allow" })).not.toBeInTheDocument();
    expect(screen.getByText("✓ cancelled")).toBeInTheDocument();
  });
});
