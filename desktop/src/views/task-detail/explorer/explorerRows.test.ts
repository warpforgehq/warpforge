import { describe, expect, it } from "vitest";

import type { DirListing } from "../../../protocol";
import {
  buildStatusIndex,
  buildVisibleRows,
  parentFolders,
  staleExpanded,
  statusKind,
} from "./explorerRows";

const listings: Record<string, DirListing> = {
  "": {
    entries: [
      { ignored: false, kind: "file", name: "README.md", symlink: false },
      { ignored: true, kind: "dir", name: "coverage", symlink: false },
      { ignored: false, kind: "dir", name: "src", symlink: false },
    ],
    truncated: false,
  },
  src: {
    entries: [
      { ignored: false, kind: "file", name: "main.rs", symlink: false },
      { ignored: false, kind: "dir", name: "ui", symlink: false },
    ],
    truncated: false,
  },
};
const listing = (path: string) => listings[path];
const noStatus = buildStatusIndex([]);

describe("buildVisibleRows", () => {
  it("lists folders before files and descends only into expanded folders", () => {
    const rows = buildVisibleRows(listing, new Set(["src"]), noStatus, true);
    expect(rows.map((row) => [row.path, row.depth])).toEqual([
      ["coverage", 0],
      ["src", 0],
      ["src/ui", 1],
      ["src/main.rs", 1],
      ["README.md", 0],
    ]);
    expect(rows.find((row) => row.path === "src")?.expanded).toBe(true);
  });

  it("marks an expanded folder whose listing has not arrived as loading", () => {
    const rows = buildVisibleRows(listing, new Set(["src", "src/ui"]), noStatus, true);
    expect(rows.find((row) => row.path === "src/ui")?.loading).toBe(true);
    expect(rows.find((row) => row.path === "src")?.loading).toBe(false);
  });

  it("keeps ignored entries, flagged, unless they are hidden", () => {
    const shown = buildVisibleRows(listing, new Set(), noStatus, true);
    expect(shown.find((row) => row.path === "coverage")?.ignored).toBe(true);
    const hidden = buildVisibleRows(listing, new Set(), noStatus, false);
    expect(hidden.map((row) => row.path)).toEqual(["src", "README.md"]);
  });

  it("joins status by path and rolls the strongest one up to every ancestor", () => {
    const status = buildStatusIndex([
      { code: "??", path: "src/ui/new.ts" },
      { code: " M", path: "src/main.rs" },
    ]);
    const rows = buildVisibleRows(listing, new Set(["src"]), status, true);
    const byPath = new Map(rows.map((row) => [row.path, row.status]));
    expect(byPath.get("src/main.rs")).toBe("modified");
    expect(byPath.get("src/ui")).toBe("added");
    expect(byPath.get("src")).toBe("modified");
    expect(byPath.get("README.md")).toBeNull();
  });
});

describe("statusKind", () => {
  it.each([
    ["??", "added"],
    ["A ", "added"],
    [" M", "modified"],
    ["MM", "modified"],
    [" D", "deleted"],
    ["UU", "conflict"],
    ["AA", "conflict"],
  ])("%s is %s", (code, kind) => {
    expect(statusKind(code)).toBe(kind);
  });
});

describe("staleExpanded", () => {
  it("drops folders a loaded parent no longer lists, and keeps unknown ones", () => {
    expect(staleExpanded(["src", "gone", "src/ui", "src/old", "lib/deep"], listing)).toEqual([
      "gone",
      "src/old",
    ]);
  });
});

describe("parentFolders", () => {
  it("returns every folder that must be expanded to reveal a nested file", () => {
    expect(parentFolders("desktop/src/views/TaskDetail.tsx")).toEqual([
      "desktop",
      "desktop/src",
      "desktop/src/views",
    ]);
    expect(parentFolders("Cargo.toml")).toEqual([]);
  });
});
