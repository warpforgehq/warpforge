import { describe, expect, it } from "vitest";

import type { FileDiff } from "../../protocol";
import { estimateFileHeight, measureDiffRow } from "./diffRowLayout";

const HEADER_PX = 36;
const LINE_PX = 20;

function file(hunks: FileDiff["hunks"], path = "src/file.ts"): FileDiff {
  return { hunks, oldPath: null, path, status: "modified" };
}

function hunk(oldStart: number, oldLines: number, newStart: number, newLines: number) {
  return { lines: [], newLines, newStart, oldLines, oldStart, resolution: null };
}

describe("estimateFileHeight", () => {
  it("falls back to the fixed slot when the file is unknown", () => {
    expect(estimateFileHeight(undefined)).toBe(384);
  });

  it("tracks the changed hunks, not how far they sit into the file", () => {
    const nearTop = file([hunk(1, 4, 1, 4)]);
    const nearEnd = file([hunk(9000, 4, 9000, 4)]);

    // Same change, one near the top of a file and one near line 9000: the
    // collapsed render is the same height, so the estimate must be too. The
    // old estimate grew with `newStart + newLines` and reserved a huge band.
    expect(estimateFileHeight(nearEnd)).toBe(estimateFileHeight(nearTop));
    expect(estimateFileHeight(nearEnd)).toBe(HEADER_PX + (4 + 5 + 6) * LINE_PX);
  });

  it("grows with the changed span of an added file", () => {
    const small = file([hunk(0, 0, 1, 20)]);
    const large = file([hunk(0, 0, 1, 300)]);

    expect(estimateFileHeight(large) - estimateFileHeight(small)).toBe(280 * LINE_PX);
  });

  it("adds height per hunk for the context kept around each change", () => {
    const one = file([hunk(1, 3, 1, 3)]);
    const two = file([hunk(1, 3, 1, 3), hunk(500, 3, 500, 3)]);

    expect(estimateFileHeight(two) - estimateFileHeight(one)).toBe((3 + 5) * LINE_PX);
  });

  it("counts the larger side of a hunk, so deletions are not undercounted", () => {
    const changed = file([hunk(1, 40, 1, 4)]);
    expect(estimateFileHeight(changed)).toBe(HEADER_PX + (40 + 5 + 6) * LINE_PX);
  });
});

/** Minimal DOM stand-in: the guard only queries the body for a `.cm-editor`. */
function fakeRow({
  index,
  offsetHeight,
  body,
}: {
  index: number;
  offsetHeight: number;
  body?: { editor: boolean };
}) {
  const bodyEl = body
    ? {
        querySelector: (selector: string) => (body.editor && selector === ".cm-editor" ? {} : null),
      }
    : null;
  return {
    getAttribute: (name: string) => (name === "data-index" ? String(index) : null),
    offsetHeight,
    querySelector: (selector: string) => (bodyEl && selector.includes("warpforge") ? bodyEl : null),
  };
}

describe("measureDiffRow", () => {
  const files = [file([hunk(1, 4, 1, 4)]), file([hunk(1, 4, 1, 4)])];

  it("holds the estimate while the editor is still mounting", () => {
    const row = fakeRow({ body: { editor: false }, index: 0, offsetHeight: 37 });

    expect(measureDiffRow(row, files)).toBe(estimateFileHeight(files[0]));
  });

  it("uses the real height once the editor is in the body", () => {
    const row = fakeRow({ body: { editor: true }, index: 0, offsetHeight: 296 });
    const before = fakeRow({ body: { editor: false }, index: 0, offsetHeight: 296 });

    // The same transition the ResizeObserver drives: estimate, then the real
    // measurement the moment CodeMirror's editor appears.
    expect(measureDiffRow(before, files)).not.toBe(296);
    expect(measureDiffRow(row, files)).toBe(296);
  });

  it("measures a skeleton or error row normally — it has no diff body", () => {
    const row = fakeRow({ index: 1, offsetHeight: 520 });

    expect(measureDiffRow(row, files)).toBe(520);
  });

  it("falls back for a body row whose index is out of range", () => {
    const row = fakeRow({ body: { editor: false }, index: 99, offsetHeight: 37 });

    expect(measureDiffRow(row, files)).toBe(384);
  });
});
