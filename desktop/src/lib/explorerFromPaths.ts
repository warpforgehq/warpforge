import type { DirEntry, DirListing, GitStatus } from "../protocol";

/**
 * Answers `dir.list` and `git.status` from a flat file list, the way the
 * daemon would for a checkout holding exactly those files. Demo mode and
 * tests use it.
 */
export function explorerFromPaths(
  files: string[],
  { ignored = [], status = [] }: { ignored?: string[]; status?: GitStatus["entries"] } = {},
) {
  const listings = new Map<string, Map<string, DirEntry>>();
  for (const file of files) {
    const parts = file.split("/");
    parts.forEach((name, index) => {
      const parent = parts.slice(0, index).join("/");
      const path = parts.slice(0, index + 1).join("/");
      const children = listings.get(parent) ?? new Map<string, DirEntry>();
      listings.set(parent, children);
      children.set(name, {
        ignored: ignored.some((rule) => path === rule || path.startsWith(`${rule}/`)),
        kind: index === parts.length - 1 ? "file" : "dir",
        name,
        symlink: false,
      });
    });
  }
  return (method: string, params: unknown): Promise<unknown> => {
    const { path = "" } = (params ?? {}) as { path?: string };
    if (method === "dir.list") {
      const entries = [...(listings.get(path)?.values() ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return Promise.resolve({ entries, truncated: false } satisfies DirListing);
    }
    if (method === "git.status") {
      return Promise.resolve({ entries: status, truncated: false } satisfies GitStatus);
    }
    return Promise.resolve(null);
  };
}
