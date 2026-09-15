import { useCallback, useMemo, useState } from "react";

import { FindInFiles, FIND_LIMIT } from "@/components/FindInFiles";
import { QuickOpen } from "@/components/QuickOpen";
import { daemon } from "@/daemon";
import { useFindInFilesShortcut } from "@/hooks/useFindInFilesShortcut";
import { useQuickOpenShortcut } from "@/hooks/useQuickOpenShortcut";
import { requestProjectFile } from "@/lib/projectFileNav";
import { ensureProject, ensureTask, setProjectFind, setTaskFind } from "@/lib/sessionStore";
import type { FileDoc, SymbolMatch } from "@/protocol";
import { useProjectFileListQuery, useProjectFilesQuery } from "@/query";
import { useUi } from "@/store/ui";

/** The project the palettes act on when no task is open. */
export interface ProjectSubject {
  name: string;
  path: string;
}

/** The stored Find-in-Files session for a task, if the snapshot still has it. */
function taskFindSession(taskId: string) {
  const info = daemon.getState().snapshot.tasks.find((task) => task.id === taskId);
  if (!info) return null;
  return ensureTask(info.id, info.project, info.worktree ?? undefined).findInFiles;
}

/** Hosts the search palettes: owns the file-list query, the search RPCs and the
 *  double-Shift / ⌘⇧F triggers. Rendered as a child of the QueryClientProvider
 *  so its hook sees the client (App's own hooks must not query — they'd render
 *  before the provider).
 *
 *  The subject is the open task when there is one, else the project the content
 *  column is showing; every RPC and the pick target follow it. */
export function QuickOpenHost({
  openTaskId,
  hasOpenTask,
  project,
}: {
  openTaskId: string | null;
  hasOpenTask: boolean;
  project: ProjectSubject | null;
}) {
  const [open, setOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findInitial, setFindInitial] = useState("");
  const [findInitialIndex, setFindInitialIndex] = useState(0);
  const taskId = hasOpenTask ? openTaskId : null;
  const projectName = taskId ? null : (project?.name ?? null);
  const projectRoot = project?.path;
  const taskFilesQuery = useProjectFileListQuery(taskId);
  const projectFilesQuery = useProjectFilesQuery(projectName);
  const filesQuery = taskId ? taskFilesQuery : projectFilesQuery;
  const openTaskThroughNav = useUi((s) => s.openTaskWithNav);
  const openProject = useUi((s) => s.openProject);
  const setProjectSurface = useUi((s) => s.setProjectSurface);
  const hasSubject = Boolean(taskId || projectName);

  useQuickOpenShortcut(() => {
    if (hasSubject) setOpen(true);
  });
  useFindInFilesShortcut(() => {
    if (!hasSubject) return;
    const session = taskId
      ? taskFindSession(taskId)
      : projectName
        ? ensureProject(projectName, projectRoot).findInFiles
        : null;
    setFindInitial(session?.query ?? "");
    setFindInitialIndex(session?.activeIndex ?? 0);
    setFindOpen(true);
  });

  const searchSubject = useCallback(
    (query: string) =>
      daemon.request(
        "file.search",
        taskId
          ? { limit: FIND_LIMIT, query, task_id: taskId }
          : { limit: FIND_LIMIT, project: projectName, query, task_id: "" },
      ) as Promise<SymbolMatch[]>,
    [projectName, taskId],
  );
  const loadFile = useCallback(
    (path: string) =>
      (
        daemon.request(
          "file.contents",
          taskId ? { path, task_id: taskId } : { path, project: projectName },
        ) as Promise<FileDoc>
      ).then((doc) => doc.newText),
    [projectName, taskId],
  );
  const openAt = useCallback(
    (path: string, location?: { line: number; column: number }) => {
      if (taskId) {
        openTaskThroughNav(taskId, { surface: "files", path, ...location });
        return;
      }
      if (!projectName) return;
      openProject(projectName);
      setProjectSurface(projectName, "files");
      requestProjectFile({ project: projectName, path, ...location });
    },
    [openProject, openTaskThroughNav, projectName, setProjectSurface, taskId],
  );
  const persistFind = useCallback(
    (session: { query: string; activeIndex: number }) => {
      if (taskId) {
        const info = daemon.getState().snapshot.tasks.find((task) => task.id === taskId);
        if (!info) return;
        setTaskFind(
          info.id,
          info.project,
          { ...session, updatedAt: Date.now() },
          info.worktree ?? undefined,
        );
        return;
      }
      if (!projectName) return;
      setProjectFind(projectName, { ...session, updatedAt: Date.now() }, projectRoot);
    },
    [projectName, projectRoot, taskId],
  );

  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);

  return (
    <>
      <QuickOpen
        open={open}
        files={files}
        loading={filesQuery.isLoading}
        error={filesQuery.error?.message ?? null}
        onSearch={searchSubject}
        onPick={openAt}
        onClose={() => setOpen(false)}
      />
      <FindInFiles
        open={findOpen}
        onSearch={searchSubject}
        loadFile={loadFile}
        onPick={(path, line, column) => openAt(path, { column, line })}
        onClose={() => setFindOpen(false)}
        initialQuery={findInitial}
        initialActiveIndex={findInitialIndex}
        onSessionChange={persistFind}
      />
    </>
  );
}
