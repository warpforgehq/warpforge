import type { DirListing, StatusEntry } from "../../../protocol";

export type StatusKind = "conflict" | "modified" | "added" | "deleted";

/** One visible line of the tree. Rows are keyed by `path`; the root is "". */
export interface ExplorerRow {
  path: string;
  name: string;
  depth: number;
  kind: "file" | "dir";
  symlink: boolean;
  ignored: boolean;
  status: StatusKind | null;
  expanded: boolean;
  /** An expanded directory whose listing has not arrived yet. */
  loading: boolean;
}

export interface StatusIndex {
  files: Map<string, StatusKind>;
  /** The strongest status among each directory's descendants. */
  dirs: Map<string, StatusKind>;
}

const RANK: Record<StatusKind, number> = { added: 1, conflict: 4, deleted: 2, modified: 3 };

/** Porcelain v1 `XY` → the marker the tree shows. */
export function statusKind(code: string): StatusKind {
  if (code.includes("U") || code === "AA" || code === "DD") return "conflict";
  if (code === "??" || code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  return "modified";
}

export function buildStatusIndex(entries: readonly StatusEntry[]): StatusIndex {
  const files = new Map<string, StatusKind>();
  const dirs = new Map<string, StatusKind>();
  for (const entry of entries) {
    const kind = statusKind(entry.code);
    files.set(entry.path, kind);
    for (const dir of parentFolders(entry.path)) {
      const current = dirs.get(dir);
      if (!current || RANK[kind] > RANK[current]) dirs.set(dir, kind);
    }
  }
  return { dirs, files };
}

/** Every folder that must be expanded to reveal `path`, outermost first. */
export function parentFolders(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/**
 * Flattens the expanded part of the tree into the rows the list draws: folders
 * first, then files, each by name. Collapsed and unlisted folders contribute
 * only their own row.
 */
export function buildVisibleRows(
  listing: (path: string) => DirListing | undefined,
  expanded: ReadonlySet<string>,
  status: StatusIndex,
  showIgnored: boolean,
): ExplorerRow[] {
  const rows: ExplorerRow[] = [];
  const walk = (dir: string, depth: number) => {
    const entries = listing(dir)?.entries ?? [];
    const sorted = entries
      .filter((entry) => showIgnored || !entry.ignored)
      .sort(
        (a, b) =>
          Number(a.kind === "file") - Number(b.kind === "file") || a.name.localeCompare(b.name),
      );
    for (const entry of sorted) {
      const path = joinPath(dir, entry.name);
      const isDir = entry.kind === "dir";
      const open = isDir && expanded.has(path);
      rows.push({
        depth,
        expanded: open,
        ignored: entry.ignored,
        kind: entry.kind,
        loading: open && !listing(path),
        name: entry.name,
        path,
        status: (isDir ? status.dirs.get(path) : status.files.get(path)) ?? null,
        symlink: entry.symlink,
      });
      if (open) walk(path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/**
 * Expanded folders that a loaded parent listing no longer contains — renamed or
 * deleted — so they do not linger in the saved tree state.
 */
export function staleExpanded(
  expanded: Iterable<string>,
  listing: (path: string) => DirListing | undefined,
): string[] {
  const stale: string[] = [];
  for (const dir of expanded) {
    const cut = dir.lastIndexOf("/");
    const parent = cut < 0 ? "" : dir.slice(0, cut);
    const parentListing = listing(parent);
    if (!parentListing || parentListing.truncated) continue;
    const name = dir.slice(cut + 1);
    if (!parentListing.entries.some((entry) => entry.kind === "dir" && entry.name === name)) {
      stale.push(dir);
    }
  }
  return stale;
}
