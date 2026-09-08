/**
 * The changed files of a pull request as a folder tree.
 *
 * A flat list of paths is unreadable past a handful of files: every row
 * repeats `apps/conduit/src/modules/…` and the part that differs — the
 * filename — is the part that gets truncated away. Folders turn that prefix
 * into indentation, once.
 *
 * This does not reuse `components/changes/treeUtils`: that tree's node stat is
 * `FileDiff`-shaped (hunks, git status), and a pull request block has neither.
 * The shapes are close on purpose — the compaction rule especially — so the
 * two read the same way.
 */

import { countPatchStats, type PatchFileBlock } from "./pullDiff";

export interface PullTreeNode {
  /** This segment's own name — a folder name, or the file's basename. */
  name: string;
  /** Set on files only; folders have children instead. */
  path?: string;
  additions: number;
  deletions: number;
  children: Map<string, PullTreeNode>;
}

export function buildPullFileTree(blocks: readonly PatchFileBlock[]): PullTreeNode {
  const root: PullTreeNode = { additions: 0, children: new Map(), deletions: 0, name: "" };
  for (const block of blocks) {
    const stats = countPatchStats([block]);
    const parts = (block.path || "unknown file").split("/");
    let node = root;
    parts.forEach((part, index) => {
      let child = node.children.get(part);
      if (!child) {
        child = { additions: 0, children: new Map(), deletions: 0, name: part };
        node.children.set(part, child);
      }
      // A folder's counts are its subtree's, so a collapsed folder still says
      // how much of the review is inside it.
      child.additions += stats.additions;
      child.deletions += stats.deletions;
      if (index === parts.length - 1) child.path = block.path;
      node = child;
    });
  }
  return root;
}

/**
 * Collapse folders that hold exactly one folder into one row
 * (`src/lib/inbox`), the way every file tree worth using does.
 */
export function compactPullFileTree(node: PullTreeNode): PullTreeNode {
  // The root is not a row, so it never merges with its only child — doing so
  // would swallow the one folder row a single-directory pull request has.
  return withChildren(node, [...node.children.values()].map(compactNode));
}

function compactNode(node: PullTreeNode): PullTreeNode {
  const children = [...node.children.values()].map(compactNode);
  if (!node.path && children.length === 1 && !children[0].path) {
    const only = children[0];
    return { ...only, name: `${node.name}/${only.name}` };
  }
  return withChildren(node, children);
}

function withChildren(node: PullTreeNode, children: PullTreeNode[]): PullTreeNode {
  return { ...node, children: new Map(children.map((child) => [child.name, child])) };
}

export interface PullTreeRow {
  /** Stable row key: the file path, or `f:` plus the folder's own path. */
  key: string;
  node: PullTreeNode;
  depth: number;
  /** Present on folder rows — what `open` is keyed on. */
  folder?: string;
}

/** Folders first is wrong for a diff: files of the folder you just opened are
 *  what you came for. Files first, then folders, each alphabetical. */
function sortChildren(node: PullTreeNode): PullTreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    const af = a.path ? 0 : 1;
    const bf = b.path ? 0 : 1;
    return af - bf || a.name.localeCompare(b.name);
  });
}

export function folderPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** Every folder key in the tree — what "expand all" starts from. */
export function pullTreeFolders(node: PullTreeNode, parent = ""): string[] {
  const out: string[] = [];
  for (const child of node.children.values()) {
    if (child.path) continue;
    const key = folderPath(parent, child.name);
    out.push(key, ...pullTreeFolders(child, key));
  }
  return out;
}

/** The tree as rows to render, honouring which folders are open. */
export function flattenPullTree(
  node: PullTreeNode,
  open: ReadonlySet<string>,
  depth = 0,
  parent = "",
): PullTreeRow[] {
  const out: PullTreeRow[] = [];
  for (const child of sortChildren(node)) {
    if (child.path) {
      out.push({ depth, key: child.path, node: child });
      continue;
    }
    const key = folderPath(parent, child.name);
    out.push({ depth, folder: key, key: `f:${key}`, node: child });
    if (open.has(key)) out.push(...flattenPullTree(child, open, depth + 1, key));
  }
  return out;
}

/** How many files sit under a node, for the folder row's count. */
export function pullTreeFileCount(node: PullTreeNode): number {
  if (node.path) return 1;
  let total = 0;
  for (const child of node.children.values()) total += pullTreeFileCount(child);
  return total;
}
