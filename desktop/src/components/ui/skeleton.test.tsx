import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SkeletonBar, SkeletonBlock, skeletonWidth } from "./skeleton";

describe("skeletonWidth", () => {
  it("is deterministic and stays inside the 38–82% band", () => {
    for (let seed = 0; seed < 6; seed += 1) {
      for (let index = 0; index < 10; index += 1) {
        const width = skeletonWidth(seed, index);
        expect(width).toBe(skeletonWidth(seed, index));
        expect(width).toBeGreaterThanOrEqual(38);
        expect(width).toBeLessThanOrEqual(82);
      }
    }
  });

  it("changes with the index, so a list of bars does not read as one block", () => {
    expect(skeletonWidth(0, 0)).not.toBe(skeletonWidth(0, 1));
  });

  it("stays inside a narrow band without collapsing rows onto its cap", () => {
    const widths = [0, 1, 2, 3, 4, 5, 6, 7].map((row) => skeletonWidth(row, 0, 18, 40));

    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(18);
      expect(width).toBeLessThan(40);
    }
    // What `Math.min(40, skeletonWidth(...))` used to produce was one width.
    expect(new Set(widths).size).toBeGreaterThan(4);
  });
});

describe("SkeletonBlock", () => {
  it("owns exactly one pulse, is busy, and stops under reduced motion", () => {
    render(<SkeletonBlock data-testid="block" />);
    const block = screen.getByTestId("block");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block.className).toContain("animate-pulse");
    expect(block.className).toContain("[--animate-pulse:pulse_1.4s_ease-in-out_infinite]");
    expect(block.className).toContain("motion-reduce:animate-none");
  });
});

describe("SkeletonBar", () => {
  it("renders the requested tone and sizing", () => {
    render(<SkeletonBar data-testid="bar" w={50} h={10} tone="primary" />);
    const bar = screen.getByTestId("bar");

    expect(bar.className).toContain("bg-muted-foreground/15");
    expect(bar).toHaveStyle({ width: "50%", height: "10px" });
  });

  it("defaults to the muted fill", () => {
    render(<SkeletonBar data-testid="bar" />);
    expect(screen.getByTestId("bar").className).toContain("bg-muted-foreground/10");
  });
});
