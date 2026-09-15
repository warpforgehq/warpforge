import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyButton } from "./copy-button";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("CopyButton", () => {
  it("copies its value and ticks to confirm", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<CopyButton value="fix/elt-agent-harness-cube" label="branch name" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy branch name" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("fix/elt-agent-harness-cube"));
    expect(await screen.findByRole("button", { name: "Copy branch name" })).toBeInTheDocument();
  });

  it("does not throw when the clipboard is unavailable", async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);

    render(<CopyButton value="main" label="base branch" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy base branch" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});
