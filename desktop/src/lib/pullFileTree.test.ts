import { describe, expect, it } from "vitest";

import { parseUnifiedPatch } from "./pullDiff";
import {
  buildPullFileTree,
  compactPullFileTree,
  flattenPullTree,
  pullTreeFileCount,
  pullTreeFolders,
} from "./pullFileTree";

function blocks(...paths: string[]) {
  const patch = paths
    .flatMap((path) => [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,1 +1,2 @@",
      " kept",
      "+added",
    ])
    .join("\n");
  return parseUnifiedPatch(patch);
}

const tree = (...paths: string[]) => compactPullFileTree(buildPullFileTree(blocks(...paths)));

describe("pullFileTree", () => {
  it("nests files under their folders", () => {
    const root = tree("src/a.ts", "src/b.ts");
    expect([...root.children.keys()]).toEqual(["src"]);
    expect([...root.children.get("src")!.children.keys()]).toEqual(["a.ts", "b.ts"]);
  });

  it("adds a folder's counts up from its files", () => {
    const root = tree("src/a.ts", "src/b.ts");
    const src = root.children.get("src")!;
    expect(src.additions).toBe(2);
    expect(pullTreeFileCount(src)).toBe(2);
  });

  it("collapses a chain of single-child folders into one row", () => {
    const root = tree("apps/conduit/src/modules/sync.ts");
    expect([...root.children.keys()]).toEqual(["apps/conduit/src/modules"]);
  });

  it("stops collapsing where a folder branches", () => {
    const root = tree("src/lib/a.ts", "src/views/b.ts");
    expect([...root.children.get("src")!.children.keys()].sort()).toEqual(["lib", "views"]);
  });

  it("keeps a root-level file at the root", () => {
    const root = tree("CLAUDE.md", "src/a.ts");
    expect(root.children.get("CLAUDE.md")?.path).toBe("CLAUDE.md");
  });

  it("lists every folder so they can all start open", () => {
    expect(pullTreeFolders(tree("src/lib/a.ts", "src/views/b.ts")).sort()).toEqual([
      "src",
      "src/lib",
      "src/views",
    ]);
  });

  it("renders files before folders at the same depth", () => {
    const root = tree("src/z.ts", "src/nested/a.ts");
    const rows = flattenPullTree(root, new Set(["src", "src/nested"]));
    const names = rows.map((row) => row.node.name);
    expect(names).toEqual(["src", "z.ts", "nested", "a.ts"]);
  });

  it("hides the children of a closed folder", () => {
    const rows = flattenPullTree(tree("src/a.ts", "src/b.ts"), new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.folder).toBe("src");
  });

  it("keys folder rows apart from file rows", () => {
    const rows = flattenPullTree(tree("src/a.ts"), new Set(["src"]));
    expect(rows.map((row) => row.key)).toEqual(["f:src", "src/a.ts"]);
  });
});
