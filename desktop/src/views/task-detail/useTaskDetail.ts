import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_SURFACE_TABS, type SurfaceTab } from "@/components/workspace";
import { useTaskSession } from "@/hooks/useWorkspaceSession";
import {
  pruneTaskDiff,
  setTaskDiff,
  setTaskDiffHunkPosition,
  setTaskFiles,
  setTaskSurface,
} from "@/lib/sessionStore";
import { buildTaskGroupIndex } from "@/lib/taskGroups";

import { type ComposerHandle } from "../../components/Composer";
import { daemon } from "../../daemon";
import { mentionToken } from "../../lib/composerMentions";
import type {
  EditHunk,
  FileDiff,
  FileRange,
  HunkResolution,
  Snapshot,
  TaskInfo,
} from "../../protocol";
import { usePanelLayout } from "../../store/panelLayout";
import { useUi } from "../../store/ui";
import { hunkKey } from "./diffAnchors";
import { type DiffWorkspaceHandle } from "./DiffWorkspace";
import { formatFileDiffAsMessage } from "./FileDiffView";
import { useSplitResize } from "./useSplitResize";
import { useTaskQueries, type ActiveTab } from "./useTaskQueries";

export { WORKSPACE_MIN_WIDTH } from "./useSplitResize";

export function useTaskDetail(task: TaskInfo, snapshot: Snapshot) {
  const [localRes, setLocalRes] = useState<Record<string, HunkResolution>>({});
  const [diffNavigation, setDiffNavigation] = useState<{
    path: string;
    hunks: EditHunk[];
  } | null>(null);
  const [openFileTabs, setOpenFileTabs] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [gotoLocation, setGotoLocation] = useState<{
    path: string;
    line: number;
    column: number;
  } | null>(null);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [restoreHunk, setRestoreHunk] = useState<{ path: string; hunkKey: string } | null>(null);
  const [commitExpanded, setCommitExpanded] = useState(false);
  const { session: taskSession, ready: taskSessionReady } = useTaskSession(task);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const diffView = useUi((s) => s.diffView);
  const setDiffView = useUi((s) => s.setDiffView);
  const showChat = useUi((s) => s.showChat);
  const showDiff = useUi((s) => s.showDiff);
  const setShowChat = useUi((s) => s.setShowChat);
  const setShowDiff = useUi((s) => s.setShowDiff);
  const toggleChat = useUi((s) => s.toggleChat);
  const activeSurface = useUi((s) => s.activeSurface);
  const setActiveSurface = useUi((s) => s.setActiveSurface);
  const openTaskNav = useUi((s) => s.openTaskNav);
  const clearOpenTaskNav = useUi((s) => s.clearOpenTaskNav);
  const chatOnRight = usePanelLayout((s) => s.chatOnRight);
  const toggleChatOnRight = usePanelLayout((s) => s.toggleChatOnRight);
  const { foldTarget, handleWorkspaceResize, resizing, setResizing, splitRef, workspaceSize } =
    useSplitResize({ chatOnRight, setShowChat, setShowDiff });
  const repositoryOperation = useUi((s) =>
    s.repositoryOperation?.taskId === task.id ? s.repositoryOperation : null,
  );
  const taskGroupIndex = useMemo(() => buildTaskGroupIndex(snapshot.tasks), [snapshot.tasks]);
  const enabledAgents = useMemo(
    () => (snapshot.agents ?? []).filter((agent) => agent.enabled),
    [snapshot.agents],
  );
  const taskGroup = taskGroupIndex.rootByTaskId.get(task.id);
  const services = snapshot.services.filter((s) => s.project === task.project);
  const portforwards = snapshot.portforwards.filter((p) => p.project === task.project);
  const terminals = snapshot.terminals.filter((t) => t.project === task.project);

  const openCommit = useCallback(() => {
    setShowDiff(true);
    setActiveSurface("diff");
    setCommitExpanded(true);
  }, [setActiveSurface, setShowDiff]);

  useEffect(() => {
    const openCommitFromShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      openCommit();
    };
    window.addEventListener("keydown", openCommitFromShortcut);
    return () => window.removeEventListener("keydown", openCommitFromShortcut);
  }, [openCommit]);

  const composerRef = useRef<ComposerHandle>(null);
  const diffWorkspaceRef = useRef<DiffWorkspaceHandle>(null);
  const handledDiffNavigationRef = useRef<typeof diffNavigation>(null);
  const editable = task.status !== "done";

  const activeTabForQuery: ActiveTab = activeFilePath
    ? { kind: "file", path: activeFilePath }
    : { kind: "changes" };

  const {
    diff,
    diffQuery,
    projectFiles,
    fileListError,
    mentionFiles,
    mentionFilesQuery,
    fileDoc,
    queryClient,
  } = useTaskQueries(task.id, activeFilePath, activeTabForQuery, task.updatedAt);

  const openFileTab = useCallback(
    (path: string, location?: { line: number; column: number }) => {
      setOpenFileTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
      setActiveFilePath(path);
      setActiveSurface("files");
      setShowDiff(true);
      setGotoLocation(location ? { path, ...location } : null);
    },
    [setActiveSurface, setShowDiff],
  );
  const searchSymbol = useCallback(
    (query: string): Promise<import("../../protocol").SymbolMatch[]> => {
      return daemon.request("file.search", {
        limit: 50,
        query,
        task_id: task.id,
        project: task.project,
      }) as Promise<import("../../protocol").SymbolMatch[]>;
    },
    [task.id, task.project],
  );
  const openSymbol = useCallback(
    (path: string, line: number, column: number) => openFileTab(path, { line, column }),
    [openFileTab],
  );
  const clearGotoLocation = useCallback(() => setGotoLocation(null), []);
  const openDiffFile = useCallback(
    (path: string, hunks: EditHunk[] = []) => {
      setSelectedDiffFile(path);
      setActiveSurface("diff");
      setShowDiff(true);
      if (hunks.length > 0) {
        setDiffView("unified");
        // The hunk the user was sent to is the position worth remembering; a
        // volatile row index would be wrong the next time the diff loads.
        setTaskDiffHunkPosition(
          task.id,
          task.project,
          path,
          hunkKey(hunks[0]),
          task.worktree ?? undefined,
        );
      }
      setDiffNavigation({ hunks, path });
    },
    [setActiveSurface, setDiffView, setShowDiff, task.id, task.project, task.worktree],
  );

  useEffect(() => {
    if (
      activeSurface !== "diff" ||
      !diffNavigation ||
      handledDiffNavigationRef.current === diffNavigation ||
      (diffNavigation.hunks.length > 0 && diffView !== "unified") ||
      !diff?.files.some((file) => file.path === diffNavigation.path)
    ) {
      return;
    }
    // The diff workspace mounts a frame after the shell (see `DiffSurface`),
    // so its handle can be absent, or still working off an empty diff, the
    // first time this runs. Retry until it reports the scroll; bounded so a
    // path the diff never carries cannot spin forever.
    let frame = 0;
    let attempts = 0;
    const scroll = () => {
      const workspace = diffWorkspaceRef.current;
      if (workspace?.scrollToFile(diffNavigation.path, diffNavigation.hunks)) {
        handledDiffNavigationRef.current = diffNavigation;
        return;
      }
      if (attempts >= 120) return;
      attempts += 1;
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [activeSurface, diff, diffNavigation, diffView]);
  const closeFileTab = useCallback(
    (path: string) => {
      const index = openFileTabs.indexOf(path);
      const next = openFileTabs.filter((candidate) => candidate !== path);
      setOpenFileTabs(next);
      if (activeFilePath !== path) return;
      setActiveFilePath(next[Math.min(index, next.length - 1)] ?? null);
    },
    [activeFilePath, openFileTabs],
  );

  useEffect(() => {
    if (!openTaskNav) {
      return;
    }
    if (openTaskNav.surface === "files") {
      openFileTab(
        openTaskNav.path,
        openTaskNav.line ? { column: openTaskNav.column ?? 1, line: openTaskNav.line } : undefined,
      );
    } else {
      openDiffFile(openTaskNav.path, openTaskNav.hunks ?? []);
    }
    clearOpenTaskNav();
  }, [clearOpenTaskNav, openDiffFile, openFileTab, openTaskNav]);

  useEffect(() => {
    if (!diff) {
      return;
    }
    const paths = diff.files.map((f) => f.path);
    setSelectedDiffFile((current) => {
      if (current && paths.includes(current)) {
        return current;
      }
      return paths[0] ?? null;
    });
  }, [diff]);

  const resolveHunkMut = useMutation({
    mutationFn: (v: { file: string; hunkIndex: number; resolution: HunkResolution }) =>
      daemon.request("diff.resolveHunk", {
        file: v.file,
        hunk_index: v.hunkIndex,
        resolution: v.resolution,
        task_id: task.id,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["diff", task.id] }),
  });
  const resolveHunk = useCallback(
    (file: string, hunkIndex: number, resolution: HunkResolution) => {
      setLocalRes((prev) => ({ ...prev, [`${file}#${hunkIndex}`]: resolution }));
      resolveHunkMut.mutate({ file, hunkIndex, resolution });
    },
    [resolveHunkMut],
  );
  const openProjectFiles = useCallback(() => setActiveSurface("files"), [setActiveSurface]);
  const sendDiffToChat = useCallback((file: FileDiff) => {
    composerRef.current?.attachDiff(file, formatFileDiffAsMessage(file));
  }, []);
  const appendLogsToChat = useCallback((text: string) => {
    composerRef.current?.appendDraft(text);
  }, []);
  const sendSelectionToChat = useCallback((path: string, range: FileRange) => {
    composerRef.current?.appendDraft(mentionToken(path, range));
  }, []);
  const attachBrowserContext = useCallback(
    (chip: { id: string; label: string; body: string }) => {
      composerRef.current?.attachContext(chip);
    },
    [],
  );
  const attachBrowserShot = useCallback((name: string, pngBase64: string) => {
    composerRef.current?.attachImage(name, pngBase64);
  }, []);
  const diffError = diffQuery.error?.message ?? resolveHunkMut.error?.message ?? null;

  const openTabs = useMemo(() => {
    const changed = new Set((diff?.files ?? []).map((f) => f.path));
    return openFileTabs.map((path) => ({ changed: changed.has(path), path }));
  }, [diff?.files, openFileTabs]);
  const projectRoot = useMemo(
    () => snapshot.projects.find((p) => p.name === task.project)?.path.replace(/\/+$/, ""),
    [snapshot.projects, task.project],
  );
  const knownFilePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const file of projectFiles) {
      paths.add(file.path);
    }
    for (const file of diff?.files ?? []) {
      paths.add(file.path);
    }
    for (const path of openFileTabs) {
      paths.add(path);
    }
    return paths;
  }, [diff?.files, openFileTabs, projectFiles]);
  const resolveSessionFilePath = useCallback(
    (value: string): string | null => {
      let path = value.trim().replace(/^['"`]+|['"`]+$/g, "");
      path = path.replace(/:\d+(?::\d+)?$/, "");
      path = path.replace(/[),;]+$/, "");
      path = path.replace(/^\.\/+/, "");

      if (projectRoot && path.startsWith(`${projectRoot}/`)) {
        return path.slice(projectRoot.length + 1);
      }

      if (knownFilePaths.has(path)) {
        return path;
      }

      return null;
    },
    [knownFilePaths, projectRoot],
  );

  // Restore this task's editor workspace once its session has been read. An
  // explicit `openTaskNav` runs after this and wins, because it is applied in
  // an effect declared below.
  useEffect(() => {
    if (!taskSessionReady || sessionHydrated) return;
    if (taskSession.files.tabs.length > 0) setOpenFileTabs(taskSession.files.tabs);
    if (taskSession.files.activePath) setActiveFilePath(taskSession.files.activePath);
    if (taskSession.diff.selectedFile) setSelectedDiffFile(taskSession.diff.selectedFile);
    setActiveSurface(taskSession.activeSurface);
    const storedPosition = taskSession.diff.selectedFile
      ? taskSession.diff.positions[taskSession.diff.selectedFile]
      : undefined;
    if (taskSession.activeSurface === "diff" && taskSession.diff.selectedFile && storedPosition) {
      setRestoreHunk({ hunkKey: storedPosition.hunkKey, path: taskSession.diff.selectedFile });
    }
    setSessionHydrated(true);
  }, [sessionHydrated, taskSession, taskSessionReady, setActiveSurface]);

  // Persist the editor workspace back to the session. Guarded on hydration so
  // the pre-restore defaults never overwrite the stored record.
  useEffect(() => {
    if (!sessionHydrated) return;
    setTaskFiles(
      task.id,
      task.project,
      { activePath: activeFilePath, tabs: openFileTabs },
      task.worktree ?? undefined,
    );
  }, [activeFilePath, openFileTabs, sessionHydrated, task.id, task.project, task.worktree]);

  useEffect(() => {
    if (!sessionHydrated) return;
    setTaskDiff(
      task.id,
      task.project,
      { selectedFile: selectedDiffFile },
      task.worktree ?? undefined,
    );
  }, [selectedDiffFile, sessionHydrated, task.id, task.project, task.worktree]);

  useEffect(() => {
    if (!sessionHydrated) return;
    setTaskSurface(task.id, task.project, activeSurface, task.worktree ?? undefined);
  }, [activeSurface, sessionHydrated, task.id, task.project, task.worktree]);

  // A file that no longer appears in the project tree or the diff is dropped
  // from the strip rather than reopened against a path the daemon rejects.
  const listedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const file of projectFiles) paths.add(file.path);
    for (const file of diff?.files ?? []) paths.add(file.path);
    return paths;
  }, [diff?.files, projectFiles]);

  useEffect(() => {
    if (!sessionHydrated || listedPaths.size === 0) return;
    const valid = openFileTabs.filter((path) => listedPaths.has(path));
    if (valid.length !== openFileTabs.length) setOpenFileTabs(valid);
    if (activeFilePath && !listedPaths.has(activeFilePath)) {
      setActiveFilePath(valid[valid.length - 1] ?? null);
    }
  }, [activeFilePath, listedPaths, openFileTabs, sessionHydrated]);

  // A hunk position is restored only after the diff actually carries the file.
  // The workspace mounts a frame behind the shell, so retry like a diff
  // navigation; bounded, so a hunk the diff no longer has cannot spin. The
  // restore is not user-driven: if the reader clicks a file while it is
  // pending, the nonce moves and the restore gives the scroll up.
  useEffect(() => {
    if (!restoreHunk) return;
    const startNonce = diffWorkspaceRef.current?.explicitScrollNonce() ?? 0;
    let frame = 0;
    let attempts = 0;
    const scroll = () => {
      const workspace = diffWorkspaceRef.current;
      if (workspace && workspace.explicitScrollNonce() !== startNonce) {
        setRestoreHunk(null);
        return;
      }
      if (workspace?.scrollToHunk(restoreHunk.path, restoreHunk.hunkKey, { explicit: false })) {
        setRestoreHunk(null);
        return;
      }
      if (attempts >= 120) {
        setRestoreHunk(null);
        return;
      }
      attempts += 1;
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [restoreHunk]);

  // Records for files the diff no longer carries are dropped, so a deleted or
  // renamed file never keeps its fold or hunk position for 90 days.
  useEffect(() => {
    if (!diff) return;
    pruneTaskDiff(task.id, new Set(diff.files.map((file) => file.path)));
  }, [diff, task.id]);

  // Children of *this* task, for an orchestrator that delegates over MCP and
  // therefore has no `orchestrationGraph` — the pipeline is those tasks.
  const childTrees = useMemo(
    () => (taskGroup?.task.id === task.id ? taskGroup.children : []),
    [task.id, taskGroup],
  );
  const pipelineCount = task.orchestrationGraph?.nodes.length || childTrees.length || undefined;

  const surfaceTabs = useMemo<SurfaceTab[]>(() => {
    const diffCount = diff && diff.files.length > 0 ? diff.files.length : undefined;
    const runtimeCount = services.length + portforwards.length || undefined;
    const terminalCount = terminals.length || undefined;
    return (
      DEFAULT_SURFACE_TABS
        // Hidden unless this task actually farmed work out: an ordinary
        // single-agent task has no pipeline, and a permanently empty tab is
        // just a dead affordance on most of the screens in the app.
        .filter((tab) => tab.id !== "pipeline" || pipelineCount !== undefined)
        .map((tab) => {
          if (tab.id === "diff") return { ...tab, count: diffCount };
          if (tab.id === "runtime") return { ...tab, count: runtimeCount };
          if (tab.id === "terminal") return { ...tab, count: terminalCount };
          if (tab.id === "pipeline") return { ...tab, count: pipelineCount };
          return tab;
        })
    );
  }, [diff, pipelineCount, portforwards.length, services.length, terminals.length]);

  return {
    activeFilePath,
    activeSurface,
    appendLogsToChat,
    attachBrowserContext,
    attachBrowserShot,
    chatOnRight,
    childTrees,
    clearGotoLocation,
    closeFileTab,
    commitExpanded,
    composerRef,
    diff,
    diffError,
    diffView,
    diffWorkspaceRef,
    editable,
    enabledAgents,
    fileDoc,
    fileListError,
    foldTarget,
    gotoLocation,
    handleWorkspaceResize,
    localRes,
    mentionFiles,
    mentionFilesQuery,
    openCommit,
    openDiffFile,
    openFileTab,
    openFileTabs,
    openProjectFiles,
    openSymbol,
    openTabs,
    portforwards,
    projectFiles,
    projectRoot,
    queryClient,
    repositoryOperation,
    resizing,
    resolveHunk,
    resolveSessionFilePath,
    searchSymbol,
    selectedDiffFile,
    sendDiffToChat,
    sendSelectionToChat,
    services,
    setActiveFilePath,
    setActiveSurface,
    setCommitExpanded,
    setDiffView,
    setGotoLocation,
    setResizing,
    setShowDiff,
    showChat,
    showDiff,
    splitRef,
    surfaceTabs,
    taskGroup,
    taskSession,
    taskSessionReady,
    terminals,
    toggleChat,
    toggleChatOnRight,
    workspaceSize,
  };
}
