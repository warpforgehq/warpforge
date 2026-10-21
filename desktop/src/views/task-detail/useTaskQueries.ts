import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import type { FileDiff, FileDoc, ProjectFile, SessionUpdate, TaskDiff } from "../../protocol";
import { daemonQuery } from "../../query";
import { useFsWatch } from "./explorer/useFsWatch";

const EMPTY_PROJECT_FILES: ProjectFile[] = [];
/** Diffs and file docs are the heaviest reads; drop them sooner than the
 * default once nothing observes them, but keep reopening a task warm. */
const LARGE_PAYLOAD_GC_TIME = 120_000;

export type ActiveTab = { kind: "changes" } | { kind: "file"; path: string };

export function useTaskFileEditCacheSync(taskId: string, updates: SessionUpdate[]) {
  const queryClient = useQueryClient();
  const latestFileEdit = useMemo(() => {
    for (let index = updates.length - 1; index >= 0; index -= 1) {
      if (updates[index].kind === "file_edit") {
        return updates[index];
      }
    }
    return null;
  }, [updates]);

  useEffect(() => {
    if (!latestFileEdit) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["diff", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["fileList", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["fileContents", taskId] });
  }, [latestFileEdit, queryClient, taskId]);
}

export function useTaskQueries(
  taskId: string,
  activeFile: string | null,
  activeTab: ActiveTab,
  updatedAt: number,
) {
  const queryClient = useQueryClient();

  const diffQuery = useQuery({
    gcTime: LARGE_PAYLOAD_GC_TIME,
    placeholderData: keepPreviousData,
    queryFn: daemonQuery<TaskDiff>("diff.get", { task_id: taskId }),
    queryKey: ["diff", taskId],
    refetchOnWindowFocus: "always",
  });
  const diff = diffQuery.data ?? null;

  // The mention list holds untracked files too; the watch keeps it current
  // while the task is open, whether or not its Explorer is on screen.
  useFsWatch({ taskId });
  const mentionFilesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: daemonQuery<ProjectFile[]>("file.list", { task_id: taskId }),
    queryKey: ["fileList", taskId, "tracked"],
  });
  const mentionFiles = Array.isArray(mentionFilesQuery.data)
    ? mentionFilesQuery.data
    : EMPTY_PROJECT_FILES;

  const fileContentsEnabled = Boolean(activeFile) && activeTab.kind === "file";
  const fileDocQuery = useQuery({
    enabled: fileContentsEnabled,
    gcTime: LARGE_PAYLOAD_GC_TIME,
    placeholderData: keepPreviousData,
    queryFn: daemonQuery<FileDoc>("file.contents", {
      task_id: taskId,
      path: activeFile,
    }),
    queryKey: ["fileContents", taskId, activeFile],
    refetchOnWindowFocus: "always",
  });
  const fileDoc = fileContentsEnabled ? (fileDocQuery.data ?? null) : null;

  // `updatedAt` moves on every streamed chunk. The file list changes only with
  // a file edit or a git operation, which invalidate it where they happen; the
  // Explorer follows its watcher.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["diff", taskId] });
    void queryClient.invalidateQueries({ queryKey: ["fileContents", taskId] });
  }, [queryClient, taskId, updatedAt]);

  return {
    diff,
    diffQuery,
    mentionFiles,
    mentionFilesQuery,
    fileDoc,
    fileDocQuery,
    queryClient,
  };
}

export function useSplitFileQueries(
  taskId: string,
  files: FileDiff[],
  enabled: boolean,
  range: { start: number; end: number },
) {
  return useQueries({
    queries: files.map((file, index) => {
      const queryKey = ["fileContents", taskId, file.path] as const;
      const visible = index >= range.start && index <= range.end;
      return {
        enabled: enabled && visible,
        gcTime: LARGE_PAYLOAD_GC_TIME,
        placeholderData: keepPreviousData,
        queryFn: daemonQuery<FileDoc>("file.contents", {
          task_id: taskId,
          path: file.path,
        }),
        queryKey,
        staleTime: 5 * 60 * 1000,
      };
    }),
  });
}
