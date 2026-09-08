import { describe, expect, it } from "vitest";

import {
  commitRangeLabel,
  commitSpanRange,
  selectedCommitIndexes,
  toggleCommitInRange,
} from "@/lib/pullCommits";
import type { PullCommit } from "@/protocol";

/** Three commits, oldest first, each parented on the one before it. */
const commits: PullCommit[] = [
  {
    oid: "aaa1111",
    abbreviatedOid: "aaa1111",
    parentOid: "base000",
    messageHeadline: "one",
    committedDate: "",
  },
  {
    oid: "bbb2222",
    abbreviatedOid: "bbb2222",
    parentOid: "aaa1111",
    messageHeadline: "two",
    committedDate: "",
  },
  {
    oid: "ccc3333",
    abbreviatedOid: "ccc3333",
    parentOid: "bbb2222",
    messageHeadline: "three",
    committedDate: "",
  },
];

describe("selectedCommitIndexes", () => {
  it("reads a range back as the commits it covers", () => {
    expect(selectedCommitIndexes(commits, { fromOid: "aaa1111", toOid: "ccc3333" })).toEqual([
      1, 2,
    ]);
    expect(selectedCommitIndexes(commits, { fromOid: "base000", toOid: "aaa1111" })).toEqual([0]);
  });

  it("falls back to the whole pull request when nothing is selected", () => {
    expect(selectedCommitIndexes(commits, null)).toEqual([]);
  });

  it("falls back when the range no longer matches the list", () => {
    // What a force-push leaves behind: hashes that are not in this list.
    expect(selectedCommitIndexes(commits, { fromOid: "gone999", toOid: "ccc3333" })).toEqual([]);
  });
});

describe("commitSpanRange", () => {
  it("compares from the first commit's parent to the last commit", () => {
    expect(commitSpanRange(commits, 0, 2)).toEqual({ fromOid: "base000", toOid: "ccc3333" });
    // Order does not matter: a span is a span.
    expect(commitSpanRange(commits, 2, 1)).toEqual({ fromOid: "aaa1111", toOid: "ccc3333" });
  });

  it("refuses a span whose first commit has no parent to diff against", () => {
    const rootFirst = [{ ...commits[0], parentOid: "" }, ...commits.slice(1)];
    expect(commitSpanRange(rootFirst, 0, 1)).toBeNull();
  });
});

describe("toggleCommitInRange", () => {
  it("narrows to one commit from the whole pull request", () => {
    expect(toggleCommitInRange(commits, null, 1)).toEqual({
      fromOid: "aaa1111",
      toOid: "bbb2222",
    });
  });

  it("goes back to every commit when the last one is unticked", () => {
    const one = toggleCommitInRange(commits, null, 2);
    expect(toggleCommitInRange(commits, one, 2)).toBeNull();
  });

  it("grows the span to reach a commit outside it", () => {
    const one = toggleCommitInRange(commits, null, 0);
    expect(toggleCommitInRange(commits, one, 2)).toEqual({
      fromOid: "base000",
      toOid: "ccc3333",
    });
  });

  it("shrinks from whichever end was clicked", () => {
    const all = { fromOid: "base000", toOid: "ccc3333" };
    expect(toggleCommitInRange(commits, all, 0)).toEqual({
      fromOid: "aaa1111",
      toOid: "ccc3333",
    });
    expect(toggleCommitInRange(commits, all, 2)).toEqual({
      fromOid: "base000",
      toOid: "bbb2222",
    });
  });

  it("narrows to an interior commit rather than punching a hole in the span", () => {
    const all = { fromOid: "base000", toOid: "ccc3333" };
    expect(toggleCommitInRange(commits, all, 1)).toEqual({
      fromOid: "aaa1111",
      toOid: "bbb2222",
    });
  });
});

describe("commitRangeLabel", () => {
  it("counts what is being diffed", () => {
    expect(commitRangeLabel(commits, null)).toBe("3 commits");
    expect(commitRangeLabel(commits, { fromOid: "aaa1111", toOid: "bbb2222" })).toBe("1 commit");
  });
});
