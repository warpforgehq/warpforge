import { describe, expect, it } from "vitest";

import type { FileDiff } from "../../protocol";
import { toUnifiedPatch } from "./filePatch";

function file(over: Partial<FileDiff> = {}): FileDiff {
  return {
    hunks: [
      {
        lines: [" one", "-two", "+TWO"],
        newLines: 2,
        newStart: 1,
        oldLines: 2,
        oldStart: 1,
        resolution: null,
      },
    ],
    oldPath: null,
    path: "src/a.ts",
    status: "modified",
    ...over,
  };
}

describe("toUnifiedPatch", () => {
  it("emits headers plus one @@ block per hunk", () => {
    expect(toUnifiedPatch(file())).toBe(
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n",
    );
  });

  it("uses the old path for renames", () => {
    const patch = toUnifiedPatch(file({ oldPath: "src/old.ts", path: "src/new.ts" }));

    expect(patch.split("\n").slice(0, 2)).toEqual(["--- a/src/old.ts", "+++ b/src/new.ts"]);
  });

  it("emits one block per hunk in order", () => {
    const patch = toUnifiedPatch(
      file({
        hunks: [
          {
            lines: ["-a", "+b"],
            newLines: 1,
            newStart: 1,
            oldLines: 1,
            oldStart: 1,
            resolution: null,
          },
          {
            lines: ["-c", "+d"],
            newLines: 1,
            newStart: 9,
            oldLines: 1,
            oldStart: 9,
            resolution: null,
          },
        ],
      }),
    );

    expect(patch).toContain("@@ -1,1 +1,1 @@\n-a\n+b\n");
    expect(patch).toContain("@@ -9,1 +9,1 @@\n-c\n+d\n");
  });

  it("emits bare headers for a hunk-less file", () => {
    expect(toUnifiedPatch(file({ hunks: [] }))).toBe("--- a/src/a.ts\n+++ b/src/a.ts\n");
  });
});
