import type { ProjectFile } from "../../protocol";

export interface ProjectTreeNode {
  name: string;
  path?: string;
  changed?: boolean;
  children: Map<string, ProjectTreeNode>;
}

export function buildProjectTree(files: ProjectFile[]): ProjectTreeNode {
  const root: ProjectTreeNode = { children: new Map(), name: "" };
  for (const f of files) {
    // `git ls-files --others` collapses untracked directories (including
    // nested git repos it won't descend into) to a single "dir/" entry. Strip
    // the trailing slash and keep the node path-less so it renders as a folder.
    const isDir = f.path.endsWith("/");
    const parts = f.path.replace(/\/+$/, "").split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map(), name: part };
        node.children.set(part, child);
      }
      if (i === parts.length - 1 && !isDir) {
        child.path = f.path;
        child.changed = f.changed;
      }
      node = child;
    });
  }
  return root;
}

export function projectFolderKey(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

/** Every folder key the current tree actually contains. */
export function collectFolderKeys(
  node: ProjectTreeNode,
  parentPath: string,
  out: Set<string>,
): void {
  for (const child of node.children.values()) {
    if (child.path) continue;
    const key = projectFolderKey(parentPath, child.name);
    out.add(key);
    collectFolderKeys(child, key, out);
  }
}

export interface ProjectFlatRow {
  key: string;
  node: ProjectTreeNode;
  depth: number;
  fKey?: string;
}

export function flattenProjectTree(
  node: ProjectTreeNode,
  depth: number,
  parentPath: string,
  openFolders: Set<string>,
  out: ProjectFlatRow[],
): void {
  const kids = [...node.children.values()].sort((a, b) => {
    const af = a.path ? 1 : 0;
    const bf = b.path ? 1 : 0;
    return af - bf || a.name.localeCompare(b.name);
  });
  for (const child of kids) {
    if (child.path) {
      out.push({ key: child.path, node: child, depth });
    } else {
      const fk = projectFolderKey(parentPath, child.name);
      out.push({ key: `f:${fk}`, node: child, depth, fKey: fk });
      if (openFolders.has(fk)) {
        flattenProjectTree(child, depth + 1, fk, openFolders, out);
      }
    }
  }
}

export const PROJECT_ROW_HEIGHT = 28;

export function projectFileParentFolders(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}
