import type { FileDiff, GitRoot } from "../../protocol";
import { buildTree, compact, type Node } from "./treeUtils";

export const CHANGES_LABEL = "Changes";
export const UNVERSIONED_LABEL = "Unversioned Files";

/**
 * Assign each path to the git root that owns it: the nested root whose name
 * (its path relative to the primary root) is the longest matching prefix,
 * falling back to the primary root. `roots[0]` is the primary — `git.roots`
 * always returns it first.
 */
export function groupPathsByRoot(paths: string[], roots: GitRoot[]): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>(roots.map((root) => [root.path, new Set<string>()]));
  if (roots.length === 0) {
    return groups;
  }
  const [primary, ...nested] = roots;
  for (const path of paths) {
    const owner = nested
      .filter((root) => path === root.name || path.startsWith(`${root.name}/`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    groups.get((owner ?? primary).path)!.add(path);
  }
  return groups;
}

/** A section ("Changes" / "Unversioned Files") wrapping a compacted file tree. */
function section(label: string, files: FileDiff[]): Node {
  return { children: compact(buildTree(files)).children, name: label };
}

function sections(tracked: FileDiff[], untracked: FileDiff[], untrackedAvailable: boolean): Node[] {
  const out: Node[] = [];
  if (tracked.length > 0) {
    out.push(section(CHANGES_LABEL, tracked));
  }
  if (untrackedAvailable && untracked.length > 0) {
    out.push(section(UNVERSIONED_LABEL, untracked));
  }
  return out;
}

function toChildren(nodes: Node[]): Map<string, Node> {
  return new Map(nodes.map((node) => [node.name, node]));
}

/**
 * Root node for the Changes rail. One git root renders a flat tree split into
 * "Changes" and "Unversioned Files"; several roots wrap those sections under
 * one node per root, labelled with the root's name and branch.
 */
export function buildChangesRoot({
  project,
  files,
  untrackedPaths,
  untrackedAvailable,
  roots,
}: {
  project: string;
  files: FileDiff[];
  untrackedPaths: string[];
  untrackedAvailable: boolean;
  roots: GitRoot[];
}): Node {
  const untrackedSet = new Set(untrackedPaths);
  const isUntracked = (file: FileDiff) => untrackedSet.has(file.path);

  if (roots.length <= 1) {
    return {
      children: toChildren(
        sections(
          files.filter((f) => !isUntracked(f)),
          files.filter(isUntracked),
          untrackedAvailable,
        ),
      ),
      name: project,
    };
  }

  const groups = groupPathsByRoot(
    files.map((f) => f.path),
    roots,
  );
  const rootNodes = roots.flatMap((root) => {
    const owned = files.filter((f) => groups.get(root.path)!.has(f.path));
    if (owned.length === 0) {
      return [];
    }
    return [
      {
        children: toChildren(
          sections(
            owned.filter((f) => !isUntracked(f)),
            owned.filter(isUntracked),
            untrackedAvailable,
          ),
        ),
        name: root.name,
        suffix: root.branch ? `[${root.branch}]` : undefined,
      } satisfies Node,
    ];
  });
  return { children: toChildren(rootNodes), name: project };
}

export type IgnoredSectionState = "hidden" | "loading" | "unavailable" | "empty" | "list";

/** What the ignored-files section shows, given the toggle and its fetch. A
 * failed scan is "unavailable", not "empty" — same contract as untracked. */
export function ignoredSectionState(
  showIgnored: boolean,
  loading: boolean,
  ignored: string[],
  available: boolean,
): IgnoredSectionState {
  if (!showIgnored) {
    return "hidden";
  }
  if (loading) {
    return "loading";
  }
  if (!available) {
    return "unavailable";
  }
  return ignored.length === 0 ? "empty" : "list";
}

// ── Ignored-files tree ──────────────────────────────────────────────────────
// The server collapses wholly-ignored dirs to one `dir/` entry (`--directory`)
// instead of descending: `node_modules/` is 1 row, not 41,497. Such entries
// are leaves the UI never expands (JetBrains does the same); plain paths
// group into expandable folders.

export interface IgnoredFileLeaf {
  kind: "file";
  name: string;
  /** Full repo-relative path, for preview selection. */
  path: string;
}

export interface IgnoredDirNode {
  kind: "dir";
  name: string;
  /** Full repo-relative path without the trailing slash. */
  path: string;
  /** True for a collapsed `dir/` entry: rendered as a leaf, never expanded. */
  collapsed: boolean;
  children: IgnoredTreeNode[];
}

export type IgnoredTreeNode = IgnoredFileLeaf | IgnoredDirNode;

function newDir(name: string, path: string): IgnoredDirNode {
  return { children: [], collapsed: false, kind: "dir", name, path };
}

/** Group raw `git.ignored` entries into a sorted tree: dirs first, then files. */
export function buildIgnoredTree(entries: string[]): IgnoredTreeNode[] {
  const roots: IgnoredDirNode = newDir("", "");
  for (const entry of entries) {
    const collapsed = entry.endsWith("/");
    const clean = collapsed ? entry.slice(0, -1) : entry;
    if (clean.length === 0) {
      continue;
    }
    const parts = clean.split("/");
    let parent = roots;
    for (const part of parts.slice(0, -1)) {
      const childPath = parent.path.length === 0 ? part : `${parent.path}/${part}`;
      let next = parent.children.find(
        (c): c is IgnoredDirNode => c.kind === "dir" && c.name === part,
      );
      if (!next) {
        next = newDir(part, childPath);
        parent.children.push(next);
      }
      parent = next;
    }
    const leaf = parts[parts.length - 1];
    const leafPath = parent.path.length === 0 ? leaf : `${parent.path}/${leaf}`;
    const existing = parent.children.find((c) => c.name === leaf);
    if (existing) {
      // A collapsed entry for a dir we already grouped: it wins — the whole
      // dir is ignored, so there is nothing inside worth expanding.
      if (existing.kind === "dir" && collapsed) {
        existing.collapsed = true;
        existing.children = [];
      }
      continue;
    }
    parent.children.push(
      collapsed
        ? { ...newDir(leaf, leafPath), collapsed: true }
        : { kind: "file", name: leaf, path: entry },
    );
  }
  const byName = (a: IgnoredTreeNode, b: IgnoredTreeNode) => a.name.localeCompare(b.name);
  const sortRec = (node: IgnoredDirNode) => {
    node.children.sort(
      (a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || byName(a, b),
    );
    for (const child of node.children) {
      if (child.kind === "dir") {
        sortRec(child);
      }
    }
  };
  sortRec(roots);
  return roots.children;
}

export interface IgnoredCounts {
  dirs: number;
  files: number;
}

/** Recursive counts for a subtree: branch dirs + collapsed leaves are dirs. */
export function countIgnored(nodes: IgnoredTreeNode[]): IgnoredCounts {
  let dirs = 0;
  let files = 0;
  for (const node of nodes) {
    if (node.kind === "file") {
      files += 1;
    } else {
      dirs += 1;
      const inner = countIgnored(node.children);
      dirs += inner.dirs;
      files += inner.files;
    }
  }
  return { dirs, files };
}

/** "60 dirs and 18 files" / "1 dir" / "2 files" — JetBrains style, shortened. */
export function describeIgnoredCounts({ dirs, files }: IgnoredCounts): string {
  const parts: string[] = [];
  if (dirs > 0) {
    parts.push(dirs === 1 ? "1 dir" : `${dirs} dirs`);
  }
  if (files > 0) {
    parts.push(files === 1 ? "1 file" : `${files} files`);
  }
  return parts.join(" and ");
}
