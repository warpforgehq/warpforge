import {
  keepPreviousData,
  useQueries,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { daemonQuery } from "@/query";

import type { DirListing, GitStatus } from "../../../protocol";
import { buildStatusIndex, parentFolders, type StatusIndex } from "./explorerRows";

/** Whose checkout the tree shows: a task's (its worktree, else its project) or a project's. */
export interface ExplorerSubject {
  taskId?: string;
  project?: string;
}

function subjectKeys({ taskId, project }: ExplorerSubject) {
  return taskId
    ? { dirs: ["dirList", taskId], status: ["gitStatus", taskId] }
    : { dirs: ["projectDirList", project ?? ""], status: ["projectGitStatus", project ?? ""] };
}

/** Refetch every listing and the status the tree holds for `subject`. */
export function invalidateExplorer(queryClient: QueryClient, subject: ExplorerSubject) {
  const keys = subjectKeys(subject);
  void queryClient.invalidateQueries({ queryKey: keys.dirs });
  void queryClient.invalidateQueries({ queryKey: keys.status });
}

export interface ExplorerData {
  listing: (path: string) => DirListing | undefined;
  status: StatusIndex;
  rootLoading: boolean;
  rootError: string | null;
}

/**
 * One `dir.list` query for the root and for each expanded folder whose
 * ancestors are expanded too, plus the checkout's `git.status`.
 */
export function useExplorerData(
  subject: ExplorerSubject,
  expanded: ReadonlySet<string>,
): ExplorerData {
  const { taskId, project } = subject;
  const enabled = Boolean(taskId || project);
  const params = useMemo(() => (taskId ? { task_id: taskId } : { project }), [project, taskId]);
  const keys = useMemo(() => subjectKeys({ project, taskId }), [project, taskId]);
  const paths = useMemo(
    () => [
      "",
      ...[...expanded].filter((dir) => parentFolders(dir).every((parent) => expanded.has(parent))),
    ],
    [expanded],
  );

  const combine = useCallback(
    (results: UseQueryResult<DirListing>[]) => ({
      data: results.map((result) => result.data),
      rootError: results[0]?.error?.message ?? null,
      rootLoading: results[0]?.isLoading ?? false,
    }),
    [],
  );
  const dirs = useQueries({
    combine,
    queries: paths.map((path) => ({
      enabled,
      queryFn: daemonQuery<DirListing>("dir.list", { ...params, path }),
      queryKey: [...keys.dirs, path],
    })),
  });

  const statusQuery = useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: daemonQuery<GitStatus>("git.status", params),
    queryKey: keys.status,
  });
  const status = useMemo(
    () => buildStatusIndex(statusQuery.data?.entries ?? []),
    [statusQuery.data],
  );

  const listing = useMemo(() => {
    const byPath = new Map<string, DirListing>();
    paths.forEach((path, index) => {
      const data = dirs.data[index];
      if (data) byPath.set(path, data);
    });
    return (path: string) => byPath.get(path);
  }, [dirs.data, paths]);

  return { listing, rootError: dirs.rootError, rootLoading: dirs.rootLoading, status };
}
