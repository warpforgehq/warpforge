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

const HEADER_PX = 36;
const ROW_PX = 20;

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

  it("draws as many rows as the reserved height holds, leaving no dead gap", () => {
    for (const height of [196, 384, 520]) {
      const { unmount } = render(<FileDiffSkeleton file={file} height={height} index={0} />);

      const rows = screen.getAllByTestId("file-skeleton-row");
      expect(rows).toHaveLength(Math.floor((height - HEADER_PX) / ROW_PX));
      expect(height - HEADER_PX - rows.length * ROW_PX).toBeLessThan(ROW_PX);
      unmount();
    }
  });

  it("caps a huge file and hands the remainder to a fading tail, not to a void", () => {
    render(<FileDiffSkeleton file={file} height={6036} index={0} />);

    expect(screen.getAllByTestId("file-skeleton-row")).toHaveLength(24);
    const tail = screen.getByTestId("file-skeleton-tail");
    expect(tail.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(tail.style.maskImage).toContain("linear-gradient");
  });

  it("puts every content bar in one column, tinted rows included", () => {
    render(<FileDiffSkeleton file={file} height={384} index={1} />);

    const rows = screen.getAllByTestId("file-skeleton-row");
    const lanes = rows.map((row) => row.querySelector('[data-lane="text"]')!);
    // One class string for every text column: the lanes to its left are fixed
    // width, so the bars start at one x whatever the row's kind is.
    expect(new Set(lanes.map((lane) => lane.className)).size).toBe(1);
    for (const row of rows) {
      expect(row.className).not.toContain("ml-auto");
      expect(row.firstElementChild!.className).toContain("w-10");
    }
  });

  it("reads as a diff: context, addition and deletion rows, tinted in place", () => {
    render(<FileDiffSkeleton file={file} height={384} index={0} />);

    const kinds = screen.getAllByTestId("file-skeleton-row").map((row) => row.dataset.kind);
    expect(new Set(kinds)).toEqual(new Set(["ctx", "add", "del"]));

    const added = screen.getAllByTestId("file-skeleton-row").find((r) => r.dataset.kind === "add")!;
    expect(added.querySelector('[data-lane="text"] > span')!.className).toContain("bg-ok/15");
  });

  it("owns one pulse and goes static under reduced motion", () => {
    const { container } = render(<FileDiffSkeleton file={file} height={384} index={0} />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(screen.getByTestId("file-skeleton").className).toContain("motion-reduce:animate-none");
  });
});
