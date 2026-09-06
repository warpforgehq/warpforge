import { describe, expect, it } from "vitest";

import type { FileDiff, GitRoot } from "@/protocol";

import {
  buildChangesRoot,
  buildIgnoredTree,
  CHANGES_LABEL,
  countIgnored,
  describeIgnoredCounts,
  groupPathsByRoot,
  ignoredSectionState,
  type IgnoredDirNode,
  type IgnoredTreeNode,
  UNVERSIONED_LABEL,
} from "./changesTree";
import { leaves, type Node } from "./treeUtils";

function file(path: string, status: FileDiff["status"] = "modified"): FileDiff {
  return {
    hunks: [
      { lines: ["+one"], newLines: 1, newStart: 1, oldLines: 0, oldStart: 0, resolution: null },
    ],
    oldPath: null,
    path,
    status,
  };
}

function root(name: string, path: string, branch: string | null = "main"): GitRoot {
  return { branch, name, path, remotes: [] };
}

const childNames = (node: Node) => [...node.children.values()].map((child) => child.name);
const child = (node: Node, name: string) => node.children.get(name)!;

/** Narrow an ignored-tree node to a dir, failing the test otherwise. */
function asDir(node: IgnoredTreeNode): IgnoredDirNode {
  if (node.kind !== "dir") {
    throw new Error(`expected a dir node, got ${node.kind} (${node.name})`);
  }
  return node;
}

describe("groupPathsByRoot", () => {
  it("sends everything to the primary root when there is only one", () => {
    const primary = root("warpforge", "/repo");

    const groups = groupPathsByRoot(["a.ts", "src/b.ts"], [primary]);

    expect([...groups.get("/repo")!]).toEqual(["a.ts", "src/b.ts"]);
  });

  it("assigns nested paths to the nested root and the rest to the primary", () => {
    const primary = root("warpforge", "/repo");
    const nested = root("vendor/lib", "/repo/vendor/lib", "release");

    const groups = groupPathsByRoot(["src/a.ts", "vendor/lib/b.ts"], [primary, nested]);

    expect([...groups.get("/repo")!]).toEqual(["src/a.ts"]);
    expect([...groups.get("/repo/vendor/lib")!]).toEqual(["vendor/lib/b.ts"]);
  });

  it("gives an overlapping path to the deepest matching root", () => {
    const primary = root("warpforge", "/repo");
    const outer = root("vendor", "/repo/vendor");
    const inner = root("vendor/lib", "/repo/vendor/lib");

    const groups = groupPathsByRoot(["vendor/lib/b.ts", "vendor/c.ts"], [primary, outer, inner]);

    expect([...groups.get("/repo/vendor/lib")!]).toEqual(["vendor/lib/b.ts"]);
    expect([...groups.get("/repo/vendor")!]).toEqual(["vendor/c.ts"]);
    expect(groups.get("/repo")!.size).toBe(0);
  });
});

describe("buildChangesRoot", () => {
  const tracked = file("src/a.ts");
  const untracked = file("src/new.ts", "added");

  it("keeps one root flat: a Changes and an Unversioned Files group, no root node", () => {
    const node = buildChangesRoot({
      files: [tracked, untracked],
      project: "warpforge",
      roots: [root("warpforge", "/repo")],
      untrackedAvailable: true,
      untrackedPaths: [untracked.path],
    });

    expect(childNames(node)).toEqual([CHANGES_LABEL, UNVERSIONED_LABEL]);
    expect(leaves(child(node, CHANGES_LABEL))).toEqual(["src/a.ts"]);
    expect(leaves(child(node, UNVERSIONED_LABEL))).toEqual(["src/new.ts"]);
  });

  it("stays flat when the daemon reports no roots at all (non-git project)", () => {
    const node = buildChangesRoot({
      files: [tracked],
      project: "warpforge",
      roots: [],
      untrackedAvailable: true,
      untrackedPaths: [],
    });

    expect(childNames(node)).toEqual([CHANGES_LABEL]);
  });

  it("groups by root when there are several, labelling each with its branch", () => {
    const nestedFile = file("vendor/lib/b.ts");
    const node = buildChangesRoot({
      files: [tracked, nestedFile],
      project: "warpforge",
      roots: [root("warpforge", "/repo"), root("vendor/lib", "/repo/vendor/lib", "release")],
      untrackedAvailable: true,
      untrackedPaths: [],
    });

    expect(childNames(node)).toEqual(["warpforge", "vendor/lib"]);
    expect(child(node, "warpforge").suffix).toBe("[main]");
    expect(child(node, "vendor/lib").suffix).toBe("[release]");
    expect(leaves(child(node, "vendor/lib"))).toEqual(["vendor/lib/b.ts"]);
    expect(childNames(child(node, "warpforge"))).toEqual([CHANGES_LABEL]);
  });

  it("omits a root node that owns no changed files", () => {
    const node = buildChangesRoot({
      files: [tracked],
      project: "warpforge",
      roots: [root("warpforge", "/repo"), root("vendor/lib", "/repo/vendor/lib")],
      untrackedAvailable: true,
      untrackedPaths: [],
    });

    expect(childNames(node)).toEqual(["warpforge"]);
  });

  it("carries no branch suffix on a detached root", () => {
    const node = buildChangesRoot({
      files: [tracked, file("vendor/lib/b.ts")],
      project: "warpforge",
      roots: [root("warpforge", "/repo", null), root("vendor/lib", "/repo/vendor/lib", null)],
      untrackedAvailable: true,
      untrackedPaths: [],
    });

    expect(child(node, "warpforge").suffix).toBeUndefined();
  });

  it("drops the Unversioned group entirely when the scan is unavailable", () => {
    const node = buildChangesRoot({
      files: [tracked, untracked],
      project: "warpforge",
      roots: [root("warpforge", "/repo")],
      untrackedAvailable: false,
      untrackedPaths: [untracked.path],
    });

    expect(childNames(node)).toEqual([CHANGES_LABEL]);
  });

  it("shows only the Unversioned group in a repo with no tracked changes", () => {
    const node = buildChangesRoot({
      files: [untracked],
      project: "warpforge",
      roots: [root("warpforge", "/repo")],
      untrackedAvailable: true,
      untrackedPaths: [untracked.path],
    });

    expect(childNames(node)).toEqual([UNVERSIONED_LABEL]);
  });
});

describe("ignoredSectionState", () => {
  it("is hidden while the toggle is off, whatever was fetched", () => {
    expect(ignoredSectionState(false, false, ["target/x"], true)).toBe("hidden");
  });

  it("reports empty rather than a list when a repo ignores nothing", () => {
    expect(ignoredSectionState(true, false, [], true)).toBe("empty");
  });

  it("waits on the fetch before deciding it is empty", () => {
    expect(ignoredSectionState(true, true, [], true)).toBe("loading");
  });

  it("lists what came back", () => {
    expect(ignoredSectionState(true, false, [".env"], true)).toBe("list");
  });

  it("says unavailable instead of empty when the scan itself failed", () => {
    expect(ignoredSectionState(true, false, [], false)).toBe("unavailable");
  });

  it("keeps loading ahead of unavailable while the retry is in flight", () => {
    expect(ignoredSectionState(true, true, [], false)).toBe("loading");
  });

  it("stays hidden when the toggle is off even if the scan failed", () => {
    expect(ignoredSectionState(false, false, [], false)).toBe("hidden");
  });
});

describe("buildChangesRoot flat mode", () => {
  it("lists files directly under the section with no folders", () => {
    const node = buildChangesRoot({
      files: [file("src/a.ts"), file("src/nested/b.ts")],
      flat: true,
      project: "warpforge",
      roots: [],
      untrackedAvailable: true,
      untrackedPaths: [],
    });

    const changes = child(node, CHANGES_LABEL);
    expect(childNames(changes).sort()).toEqual(["src/a.ts", "src/nested/b.ts"]);
    const leaf = changes.children.get("src/nested/b.ts")!;
    expect(leaf.path).toBe("src/nested/b.ts");
    expect(leaf.stat).toBeDefined();
  });

  it("defaults to directory grouping", () => {
    const node = buildChangesRoot({
      files: [file("src/a.ts"), file("docs/b.md")],
      project: "warpforge",
      roots: [],
      untrackedAvailable: true,
      untrackedPaths: [],
    });

    expect(childNames(child(node, CHANGES_LABEL)).sort()).toEqual(["docs", "src"]);
  });
});

describe("buildIgnoredTree", () => {
  it("keeps a collapsed dir/ entry as one non-expandable leaf", () => {
    const tree = buildIgnoredTree(["node_modules/", "loose.log"]);

    expect(tree).toHaveLength(2);
    const [dir, leaf] = tree;
    expect(dir).toMatchObject({ kind: "dir", name: "node_modules", collapsed: true });
    expect(leaf).toMatchObject({ kind: "file", name: "loose.log", path: "loose.log" });
    expect(asDir(dir).children).toHaveLength(0);
  });

  it("groups plain paths into expandable folders, dirs before files", () => {
    const tree = buildIgnoredTree(["apps/api/.env", "apps/api/dist/", ".env.local"]);

    expect(tree.map((n) => n.name)).toEqual(["apps", ".env.local"]);
    const apps = asDir(tree[0]);
    expect(apps.collapsed).toBe(false);
    expect(apps.children.map((n) => n.name)).toEqual(["api"]);
    // .env (file) sorts after dist/ (dir).
    expect(asDir(apps.children[0]).children.map((n) => n.name)).toEqual(["dist", ".env"]);
  });

  it("a collapsed entry wins over already-grouped children", () => {
    // Defensive: real git never emits both, but if it did the whole dir is
    // ignored and there is nothing inside worth expanding.
    const tree = buildIgnoredTree(["a/f.log", "a/"]);

    expect(tree).toHaveLength(1);
    const [a] = tree;
    expect(a).toMatchObject({ kind: "dir", name: "a", collapsed: true });
    expect(asDir(a).children).toHaveLength(0);
  });
});

describe("countIgnored / describeIgnoredCounts", () => {
  it("counts branch dirs, collapsed dirs and files recursively", () => {
    const counts = countIgnored(buildIgnoredTree(["apps/api/.env", "node_modules/", ".env"]));

    expect(counts).toEqual({ dirs: 3, files: 2 });
    expect(describeIgnoredCounts(counts)).toBe("3 dirs and 2 files");
  });

  it("uses singular forms", () => {
    expect(describeIgnoredCounts({ dirs: 1, files: 0 })).toBe("1 dir");
    expect(describeIgnoredCounts({ dirs: 0, files: 1 })).toBe("1 file");
    expect(describeIgnoredCounts({ dirs: 0, files: 2 })).toBe("2 files");
    expect(describeIgnoredCounts({ dirs: 0, files: 0 })).toBe("");
  });
});
