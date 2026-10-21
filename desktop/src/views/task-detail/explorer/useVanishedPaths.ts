import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { DirListing } from "../../../protocol";
import { dirListQuery, type ExplorerSubject } from "./useExplorerData";

function splitPath(path: string): [parent: string, name: string] {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? ["", path] : [path.slice(0, cut), path.slice(cut + 1)];
}

/**
 * Paths whose folder has been listed and no longer holds them. A folder not
 * listed yet, or that could not be listed, proves nothing, so its paths stay.
 */
export function vanishedPaths(
  paths: readonly string[],
  listing: (dir: string) => DirListing | undefined,
  keep: ReadonlySet<string>,
): string[] {
  return paths.filter((path) => {
    if (keep.has(path)) return false;
    const [parent, name] = splitPath(path);
    const folder = listing(parent);
    if (!folder || folder.truncated) return false;
    return !folder.entries.some((entry) => entry.name === name);
  });
}

/**
 * Which of `paths` (open editor tabs) are gone from the checkout, checked by
 * listing only their folders — the same cached `dir.list` the Explorer reads.
 * `keep` holds paths that stay valid regardless, such as deleted files in the diff.
 */
export function useVanishedPaths(
  subject: ExplorerSubject,
  paths: readonly string[],
  keep: ReadonlySet<string>,
): string[] {
  const parents = useMemo(() => [...new Set(paths.map((path) => splitPath(path)[0]))], [paths]);
  const enabled = Boolean(subject.taskId || subject.project);
  const combine = useCallback(
    (results: UseQueryResult<DirListing>[]) => results.map((result) => result.data),
    [],
  );
  const listings = useQueries({
    combine,
    queries: parents.map((parent) => ({ ...dirListQuery(subject, parent), enabled })),
  });
  return useMemo(() => {
    const byParent = new Map<string, DirListing>();
    parents.forEach((parent, index) => {
      const data = listings[index];
      if (data) byParent.set(parent, data);
    });
    return vanishedPaths(paths, (dir) => byParent.get(dir), keep);
  }, [keep, listings, parents, paths]);
}
