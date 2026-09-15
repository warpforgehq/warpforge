import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const globalsCss = readFileSync("src/globals.css", "utf8");

describe("focus baseline", () => {
  it("draws a keyboard-only ring on bare controls without opting in", () => {
    expect(globalsCss).toMatch(/:where\([\s\S]*?button[\s\S]*?\)\s*:focus-visible/);
    expect(globalsCss).toContain("outline: 2px solid hsl(var(--ring))");
  });
});
