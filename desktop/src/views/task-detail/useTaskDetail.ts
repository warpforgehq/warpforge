import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_SURFACE_TABS, type SurfaceTab } from "@/components/workspace";
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
import { type DiffWorkspaceHandle } from "./DiffWorkspace";
import { formatFileDiffAsMessage } from "./FileDiffView";
import { useTaskQueries, type ActiveTab } from "./useTaskQueries";

/**
 * Narrowest each side of the split may be dragged to. Reaching either one is
 * also what hides that side: the drag is tracked against these, so the moment
 * the hint appears is the moment releasing folds the pane away.
 */
const CHAT_MIN_WIDTH = 360;
export const WORKSPACE_MIN_WIDTH = 360;

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
  const [commitExpanded, setCommitExpanded] = useState(false);
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
  const [workspaceSize, setWorkspaceSize] = useState<`${number}%`>("58%");
  const [resizing, setResizing] = useState(false);
  const [foldTarget, setFoldTarget] = useState<"chat" | "workspace" | null>(null);
  const foldTargetRef = useRef<"chat" | "workspace" | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
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
      }
      setDiffNavigation({ hunks, path });
    },
    [setActiveSurface, setDiffView, setShowDiff],
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
    const frame = requestAnimationFrame(() => {
      const workspace = diffWorkspaceRef.current;
      if (!workspace) {
        return;
      }
      workspace.scrollToFile(diffNavigation.path, diffNavigation.hunks);
      handledDiffNavigationRef.current = diffNavigation;
    });
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

  const aimFold = useCallback((next: "chat" | "workspace" | null) => {
    if (foldTargetRef.current === next) return;
    foldTargetRef.current = next;
    setFoldTarget(next);
  }, []);

  // The library holds a dragged pane at its minimum and only folds it once the
  // pointer is half a minimum past that, which leaves a stretch of drag where
  // nothing moves. Tracking the pointer instead lets the hint and the fold
  // share one threshold, so what the hint promises is what releasing does.
  useEffect(() => {
    if (!resizing) return;
    const track = (event: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      const chatWidth = chatOnRight ? rect.right - event.clientX : event.clientX - rect.left;
      if (chatWidth < CHAT_MIN_WIDTH) aimFold("chat");
      else if (rect.width - chatWidth < WORKSPACE_MIN_WIDTH) aimFold("workspace");
      else aimFold(null);
    };
    const cancel = () => {
      aimFold(null);
      setResizing(false);
    };
    const release = () => {
      if (foldTargetRef.current === "chat") setShowChat(false);
      if (foldTargetRef.current === "workspace") setShowDiff(false);
      setFoldTarget(null);
      setResizing(false);
      // The library reports the dragged size from its own listener on the same
      // event; clearing a frame later means `handleChatResize` still sees the
      // fold and does not persist the width the drag ended on.
      requestAnimationFrame(() => {
        foldTargetRef.current = null;
      });
    };
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [aimFold, chatOnRight, resizing, setShowChat, setShowDiff]);

  const handleWorkspaceResize = useCallback((size: `${number}%`) => {
    if (foldTargetRef.current) return;
    setWorkspaceSize(size);
  }, []);

  return {
    activeFilePath,
    activeSurface,
    appendLogsToChat,
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
    terminals,
    toggleChat,
    toggleChatOnRight,
    workspaceSize,
  };
}
