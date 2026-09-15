import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FileDiff } from "../../protocol";
import { FileDiffSkeleton } from "./FileDiffSkeleton";

const file: FileDiff = {
  hunks: [
    {
      lines: [" kept", "-old", "+new", " kept"],
      newLines: 3,
      newStart: 1,
      oldLines: 3,
      oldStart: 1,
      resolution: null,
    },
  ],
  oldPath: null,
  path: "src/module/file.ts",
  status: "modified",
};

describe("FileDiffSkeleton", () => {
  it("is a busy block that never renders loading text", () => {
    render(<FileDiffSkeleton file={file} height={384} index={2} />);

    const block = screen.getByTestId("file-skeleton");
    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("data-path", "src/module/file.ts");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<FileDiffSkeleton file={file} height={384} index={2} />);
    const first = container.querySelector('[data-testid="file-skeleton"]')!.outerHTML;

    rerender(<FileDiffSkeleton file={file} height={384} index={2} />);
    const second = container.querySelector('[data-testid="file-skeleton"]')!.outerHTML;

    expect(second).toBe(first);
  });

  it("fills the estimate: the slot height matches the virtualizer's estimate", () => {
    render(<FileDiffSkeleton file={file} height={584} index={0} />);
    const block = screen.getByTestId("file-skeleton") as HTMLElement;
    expect(block.style.height).toBe("584px");
  });
});
