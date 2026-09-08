import { describe, expect, it } from "vitest";

import { groupPullFiles, pullFileGroupOf } from "@/lib/pullFileGroups";

describe("pullFileGroupOf", () => {
  it("reads prose, doc folders and datasets as documentation", () => {
    for (const path of [
      "README.md",
      "docs/adr/0010-pull-request-inbox.md",
      "docs/RELEASING.mdx",
      "apps/api/doc/notes.rst",
      "dataset/gold-review-A.jsonl",
      "apps/api/datasets/pilot-words.json",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → documentation`);
    }
  });

  it("reads everything else as implementation", () => {
    for (const path of [
      "src/daemon/actor.rs",
      "desktop/src/views/InboxView.tsx",
      "scripts/validate-gold.ts",
      // "documentation" in a file name is not a docs folder.
      "src/documentation_test.rs",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → implementation`);
    }
  });
});

describe("groupPullFiles", () => {
  it("splits the files and sums each group's additions", () => {
    const groups = groupPullFiles([
      { path: "src/a.ts", additions: 10, deletions: 2 },
      { path: "docs/b.md", additions: 30, deletions: 0 },
      { path: "src/nested/c.ts", additions: 5, deletions: 1 },
    ]);
    // Documentation leads: the long implementation list used to bury it.
    expect(groups.map((group) => group.id)).toEqual(["documentation", "implementation"]);
    expect(groups[1].files.map((file) => file.name)).toEqual(["a.ts", "c.ts"]);
    expect(groups[1].additions).toBe(15);
    expect(groups[1].deletions).toBe(3);
    expect(groups[0].additions).toBe(30);
  });

  it("splits a path into the name it leads with and the directory behind it", () => {
    const [group] = groupPullFiles([
      { path: "apps/api/scripts/types.ts", additions: 1, deletions: 0 },
    ]);
    expect(group.files[0]).toMatchObject({
      dir: "apps/api/scripts",
      name: "types.ts",
      tag: undefined,
    });
  });

  it("notes a dataset file so the row says what it is", () => {
    const groups = groupPullFiles([
      { path: "dataset/gold-review-A.jsonl", additions: 4, deletions: 0 },
      { path: "apps/api/fixtures/words.json", additions: 1, deletions: 0 },
    ]);
    // The note is about the kind of file, not about which group it landed in:
    // a fixture is implementation, and still worth saying "dataset" about.
    for (const group of groups) expect(group.files[0].tag).toBe("dataset");
  });

  it("drops a group with nothing in it", () => {
    const groups = groupPullFiles([{ path: "src/a.ts", additions: 1, deletions: 0 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("implementation");
  });
});
