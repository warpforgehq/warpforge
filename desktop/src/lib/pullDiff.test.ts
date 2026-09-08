import { describe, expect, it } from "vitest";

import {
  countPatchStats,
  findPatchBlock,
  pairHunkLines,
  parseUnifiedPatch,
  quoteFromDiffHunk,
  quotePatchLines,
} from "./pullDiff";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " unchanged",
  "-removed line",
  "+added line",
  " more context",
  "+another addition",
  "diff --git a/bin/img b/bin/img",
  "new file mode 100644",
  "Binary files /dev/null and b/bin/img differ",
].join("\n");

describe("parseUnifiedPatch", () => {
  it("splits the patch into per-file blocks with paths", () => {
    const blocks = parseUnifiedPatch(PATCH);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.path).toBe("src/a.ts");
    expect(blocks[0]?.oldPath).toBe("src/a.ts");
    expect(blocks[1]?.path).toBe("bin/img");
  });

  it("reads hunk headers and numbers lines as git would", () => {
    const [block] = parseUnifiedPatch(PATCH);
    const hunk = block?.hunks[0];
    expect(hunk?.header).toBe("@@ -1,3 +1,4 @@");
    expect(hunk?.oldStart).toBe(1);
    expect(hunk?.newStart).toBe(1);

    const kinds = hunk?.lines.map((line) => line.kind);
    expect(kinds).toEqual(["context", "del", "add", "context", "add"]);

    const context = hunk?.lines[0];
    expect(context?.oldNumber).toBe(1);
    expect(context?.newNumber).toBe(1);
    // Additions advance only the new side; deletions only the old.
    const removed = hunk?.lines[1];
    expect(removed?.oldNumber).toBe(2);
    expect(removed?.newNumber).toBeUndefined();
    const added = hunk?.lines[2];
    expect(added?.newNumber).toBe(2);
    expect(added?.oldNumber).toBeUndefined();
  });

  it("marks binary files and renders nothing for them", () => {
    const [, binary] = parseUnifiedPatch(PATCH);
    expect(binary?.binary).toBe(true);
    expect(binary?.hunks).toHaveLength(0);
  });

  it("counts additions and deletions across every hunk", () => {
    const blocks = parseUnifiedPatch(PATCH);
    expect(countPatchStats(blocks)).toEqual({ additions: 2, deletions: 1 });
  });

  it("degrades unknown content to a meta block instead of throwing", () => {
    const blocks = parseUnifiedPatch("some server prose, not a diff");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.hunks[0]?.lines[0]?.kind).toBe("meta");
  });

  it("gives every line a stable id the renderer can key on", () => {
    const [block] = parseUnifiedPatch(PATCH);
    const ids = block?.hunks[0]?.lines.map((line) => line.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops the \\ No newline marker rather than rendering it", () => {
    const patch = `${PATCH}\n\\ No newline at end of file`;
    const [block] = parseUnifiedPatch(patch);
    const hunk = block?.hunks[0];
    expect(hunk?.lines.some((line) => line.text.includes("No newline"))).toBe(false);
  });
});

describe("parseUnifiedPatch and /dev/null", () => {
  it("does not treat the missing side of an addition as a path", () => {
    const [block] = parseUnifiedPatch(
      [
        "diff --git a/src/new.ts b/src/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1 @@",
        "+added",
      ].join("\n"),
    );
    expect(block?.path).toBe("src/new.ts");
    // Both sides name the real file, so the header shows no "x → y" arrow.
    expect(block?.oldPath).toBe("src/new.ts");
  });

  it("keeps a deleted file's own path instead of naming it /dev/null", () => {
    const [block] = parseUnifiedPatch(
      [
        "diff --git a/src/gone.ts b/src/gone.ts",
        "deleted file mode 100644",
        "--- a/src/gone.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-removed",
      ].join("\n"),
    );
    expect(block?.path).toBe("src/gone.ts");
    expect(block?.oldPath).toBe("src/gone.ts");
  });
});

describe("pairHunkLines", () => {
  function rows(patch: string) {
    const [block] = parseUnifiedPatch(patch);
    return pairHunkLines(block?.hunks[0]?.lines ?? []);
  }

  function patchOf(...body: string[]) {
    return [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,4 +1,4 @@",
      ...body,
    ].join("\n");
  }

  it("shows a context line on both sides", () => {
    const [row] = rows(patchOf(" unchanged"));
    expect(row?.left?.text).toBe("unchanged");
    expect(row?.right?.text).toBe("unchanged");
  });

  it("zips a replaced line into one row", () => {
    const paired = rows(patchOf("-before", "+after"));
    expect(paired).toHaveLength(1);
    expect(paired[0]?.left?.text).toBe("before");
    expect(paired[0]?.right?.text).toBe("after");
  });

  it("spills the longer run into rows with an empty counterpart", () => {
    const paired = rows(patchOf("-one", "-two", "+only"));
    expect(paired).toHaveLength(2);
    expect(paired[0]?.right?.text).toBe("only");
    expect(paired[1]?.left?.text).toBe("two");
    expect(paired[1]?.right).toBeNull();
  });

  it("leaves the old side empty for a pure insertion", () => {
    const paired = rows(patchOf("+brand new"));
    expect(paired[0]?.left).toBeNull();
    expect(paired[0]?.right?.text).toBe("brand new");
  });

  it("does not pair changes across an intervening context line", () => {
    const paired = rows(patchOf("-gone", " kept", "+added"));
    expect(paired).toHaveLength(3);
    expect(paired[0]?.right).toBeNull();
    expect(paired[2]?.left).toBeNull();
  });

  it("keys every row uniquely", () => {
    const paired = rows(patchOf(" a", "-b", "+c", " d", "+e"));
    const ids = paired.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("quotePatchLines", () => {
  const block = parseUnifiedPatch(
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,5 +1,5 @@",
      " one",
      " two",
      "-three",
      "+THREE",
      " four",
      " five",
    ].join("\n"),
  )[0];

  it("quotes the anchor line with context, post-image first", () => {
    const quote = quotePatchLines(block, 3);
    expect(quote).not.toBeNull();
    expect(quote?.startNumber).toBe(2);
    expect(quote?.lines.map((line) => line.text)).toEqual([
      "two",
      "three",
      "THREE",
      "four",
      "five",
    ]);
  });

  it("falls back to the pre-image for a line the diff removed", () => {
    const quote = quotePatchLines(block, 3);
    expect(quote?.lines.some((line) => line.kind === "del" && line.text === "three")).toBe(true);
  });

  it("returns null when the patch no longer carries the line", () => {
    expect(quotePatchLines(block, 99)).toBeNull();
  });
});

describe("quotePatchLines anchors", () => {
  const block = parseUnifiedPatch(
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,4 +10,4 @@",
      " ten",
      " eleven",
      "+TWELVE",
      " thirteen",
    ].join("\n"),
  )[0];

  it("quotes nothing rather than guessing when the exact line is gone", () => {
    // The nearest-line fallback once showed a table's columns under a comment
    // about a schema header — a wrong quote is worse than no quote.
    expect(quotePatchLines(block, 14)).toBeNull();
  });

  it("gives up only when the comment is nowhere near the patch", () => {
    expect(quotePatchLines(block, 500)).toBeNull();
  });
});

describe("findPatchBlock", () => {
  const patch = [
    "diff --git a/old/dir/001_initial_schema.sql b/new/dir/001_initial_schema.sql",
    "similarity index 97%",
    "rename from old/dir/001_initial_schema.sql",
    "rename to new/dir/001_initial_schema.sql",
    "diff --git a/keep.ts b/keep.ts",
    "--- a/keep.ts",
    "+++ b/keep.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n");

  it("matches a thread's stale path by basename when the file was renamed", () => {
    const blocks = parseUnifiedPatch(patch);
    const found = findPatchBlock(blocks, "values/eltsource-config/001_initial_schema.sql");
    expect(found?.path).toBe("new/dir/001_initial_schema.sql");
  });

  it("prefers an exact path and gives up on a true stranger", () => {
    const blocks = parseUnifiedPatch(patch);
    expect(findPatchBlock(blocks, "keep.ts")?.path).toBe("keep.ts");
    expect(findPatchBlock(blocks, "unrelated/other.rs")).toBeUndefined();
  });
});

describe("quoteFromDiffHunk", () => {
  // The exact shape that once went wrong: a comment anchored at lines 1–7 of
  // a schema file's first push, whose numbers in the current diff belong to
  // entirely different text.
  const hunk = [
    "@@ -0,0 +1,9 @@",
    "+-- Initial database schema",
    "+-- Migration: 001_initial_schema",
    "+-- Created: 2025-01-08",
    "+-- Description: core tables",
    "+",
    "+-- Enable UUID extension",
    '+CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
    "+CREATE TABLE IF NOT EXISTS dim_demographic",
    "+(",
    "+    client_key BIGINT NOT NULL,",
  ].join("\n");

  it("quotes the commented version's lines, not the current patch's", () => {
    const quote = quoteFromDiffHunk(hunk, 7, 1);
    expect(quote?.startNumber).toBe(1);
    const texts = quote?.lines.map((line) => line.text) ?? [];
    expect(texts).toContain("-- Initial database schema");
    expect(texts).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    expect(texts).not.toContain("    client_key BIGINT NOT NULL,");
  });

  it("falls back to the end anchor when the range start is off the hunk", () => {
    const quote = quoteFromDiffHunk(hunk, 8);
    expect(quote?.lines.map((line) => line.text) ?? []).toContain(
      '+CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'.slice(1),
    );
  });

  it("returns null without a @@ header to number the rows", () => {
    expect(quoteFromDiffHunk("+loose lines\n+without a header", 1)).toBeNull();
  });
});
