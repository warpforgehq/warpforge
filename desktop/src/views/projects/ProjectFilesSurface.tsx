import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { daemon } from "@/daemon";
import { useProjectSession } from "@/hooks/useWorkspaceSession";
import { setProjectEditorView, setProjectFiles } from "@/lib/sessionStore";
import type { FileDoc } from "@/protocol";
import { daemonQuery, useProjectFilesQuery } from "@/query";

import { FilesSurface, type OpenFileTab } from "../task-detail/FilesSurface";

export interface ProjectFilesSurfaceProps {
  project: string;
  rootPath: string;
}

/**
 * Browsing a project's checkout with no task open.
 *
 * Same tab strip/tree/editor as the task Files surface, but now editable:
 * saves go straight to the project checkout via `file.save {project}` and
 * commits via `git.commit {project}`. The gutter shows WebStorm-style
 * change bars (green for added/modified, triangle for deleted) with
 * click-to-revert and per-hunk commit.
 *
 * Open tabs, the active file and editor cursor/scroll live in the workspace
 * session (`project:<name>`), so switching project no longer destroys them.
 */
export function ProjectFilesSurface({ project, rootPath }: ProjectFilesSurfaceProps) {
  const { session } = useProjectSession(project, rootPath);
  const open = session.files;
  const filesQuery = useProjectFilesQuery(project, false);
  const files = useMemo(
    () => (Array.isArray(filesQuery.data) ? filesQuery.data : []),
    [filesQuery.data],
  );

  const docQuery = useQuery({
    enabled: Boolean(open.activePath),
    queryFn: daemonQuery<FileDoc>("file.contents", { project, path: open.activePath }),
    queryKey: ["projectFileContents", project, open.activePath ?? ""],
  });

  const [gotoLocation, setGotoLocation] = useState<{
    path: string;
    line: number;
    column: number;
  } | null>(null);
  const openFile = useCallback(
    (path: string, location?: { line: number; column: number }) => {
      setProjectFiles(
        project,
        {
          activePath: path,
          tabs: open.tabs.includes(path) ? open.tabs : [...open.tabs, path],
        },
        rootPath,
      );
      setGotoLocation(location ? { path, ...location } : null);
    },
    [open.tabs, project, rootPath],
  );

  // Closing the active tab falls back to the one opened before it, so the
  // editor is never left showing a file that is no longer in the strip.
  const closeFile = useCallback(
    (path: string) => {
      const remaining = open.tabs.filter((tab) => tab !== path);
      setProjectFiles(
        project,
        {
          activePath:
            open.activePath === path
              ? (remaining[remaining.length - 1] ?? null)
              : open.activePath,
          tabs: remaining,
        },
        rootPath,
      );
    },
    [open.activePath, open.tabs, project, rootPath],
  );

  const openTabs = useMemo<OpenFileTab[]>(
    () =>
      open.tabs.map((path) => ({
        changed: files.find((file) => file.path === path)?.changed ?? false,
        path,
      })),
    [files, open.tabs],
  );

  const handleSave = useCallback(
    (content: string) => {
      if (!open.activePath) return;
      void daemon.request("file.save", {
        project,
        path: open.activePath,
        content,
        task_id: "",
      });
    },
    [open.activePath, project],
  );

  const searchSymbol = useCallback(
    (query: string) =>
      daemon.request("file.search", { limit: 50, query, task_id: "", project }) as Promise<
        import("@/protocol").SymbolMatch[]
      >,
    [project],
  );

  const openSymbol = useCallback(
    (path: string, line: number, column: number) => openFile(path, { line, column }),
    [openFile],
  );

  const handleViewChange = useCallback(
    (position: { anchor: number; head: number; scrollLeft: number; scrollTop: number }) => {
      if (!open.activePath) return;
      setProjectEditorView(project, open.activePath, position, rootPath);
    },
    [open.activePath, project, rootPath],
  );

  const treeState = useMemo(
    () => ({
      expandedDirs: open.expandedDirs,
      onChange: (next: {
        expandedDirs: string[];
        scrollTop: number;
        scrollLeft: number;
      }) =>
        setProjectFiles(
          project,
          {
            expandedDirs: next.expandedDirs,
            treeScrollLeft: next.scrollLeft,
            treeScrollTop: next.scrollTop,
          },
          rootPath,
        ),
      scrollLeft: open.treeScrollLeft,
      scrollTop: open.treeScrollTop,
    }),
    [open.expandedDirs, open.treeScrollLeft, open.treeScrollTop, project, rootPath],
  );

  return (
    <FilesSurface
      projectFiles={files}
      fileListError={filesQuery.error?.message ?? null}
      activeFilePath={open.activePath}
      onSelectTreeFile={openFile}
      openTabs={openTabs}
      onSelectTab={openFile}
      onCloseTab={closeFile}
      fileDoc={docQuery.data ?? null}
      fileDocError={docQuery.error?.message ?? null}
      editable={true}
      taskId=""
      project={project}
      onSave={handleSave}
      rootPath={rootPath}
      onRefresh={() => void filesQuery.refetch()}
      onGotoDefinition={searchSymbol}
      onOpenSymbol={openSymbol}
      gotoLocation={gotoLocation}
      onGotoLocationHandled={() => setGotoLocation(null)}
      restoreView={open.activePath ? (open.views[open.activePath] ?? null) : null}
      onViewChange={handleViewChange}
      treeState={treeState}
      treeResetKey={project}
    />
  );
}
