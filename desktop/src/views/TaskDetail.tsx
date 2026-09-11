import { useMutation } from "@tanstack/react-query";
import { Folder, Loader2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { Card } from "@/components/ui/card";
import { Panel, PanelCollapseHint, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import {
  DEFAULT_SURFACE_TABS,
  FlipButton,
  FocusButton,
  type SurfaceTab,
} from "@/components/workspace";
import { useTaskSessionUpdates } from "@/hooks/useTaskSessionUpdates";
import { sessionActivity } from "@/lib/sessionActivity";
import { buildTaskGroupIndex } from "@/lib/taskGroups";
import { cn } from "@/lib/utils";

import { AgentLimitsExhaustedBanner } from "../components/AgentLimitsExhaustedBanner";
import { ChatTranscript } from "../components/ChatTranscript";
import type { ComposerHandle } from "../components/Composer";
import { ModelMismatchBanner } from "../components/ModelMismatchBanner";
import { TerminalWorkspaceView } from "../components/runtime/TerminalWorkspace";
import { RuntimePanel } from "../components/RuntimePanel";
import { SessionLostBanner } from "../components/SessionLostBanner";
import { TaskAgentSwitcher } from "../components/TaskAgentSwitcher";
import { daemon } from "../daemon";
import { mentionToken } from "../lib/composerMentions";
import type {
  CommandInfo,
  EditHunk,
  FileDiff,
  FileRange,
  HunkResolution,
  Snapshot,
  TaskInfo,
} from "../protocol";
import { usePanelLayout } from "../store/panelLayout";
import { useUi } from "../store/ui";
import { DiffSurface } from "./task-detail/DiffSurface";
import { type DiffWorkspaceHandle } from "./task-detail/DiffWorkspace";
import { formatFileDiffAsMessage } from "./task-detail/FileDiffView";
import { FilesSurface } from "./task-detail/FilesSurface";
import { GitWorkspaceControls } from "./task-detail/GitWorkspaceControls";
import { PipelineSurface } from "./task-detail/PipelineSurface";
import { TaskSurfaceTabs } from "./task-detail/TaskSurfaceTabs";
import {
  useTaskFileEditCacheSync,
  useTaskQueries,
  type ActiveTab,
} from "./task-detail/useTaskQueries";

interface Props {
  task: TaskInfo;
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  onOpenPush: () => void;
}

const EMPTY_TASK_COMMANDS: CommandInfo[] = [];

/**
 * Narrowest each side of the split may be dragged to. Reaching either one is
 * also what hides that side: the drag is tracked against these, so the moment
 * the hint appears is the moment releasing folds the pane away.
 */
const CHAT_MIN_WIDTH = 360;
const WORKSPACE_MIN_WIDTH = 360;

type TaskConversationProps = Omit<
  ComponentProps<typeof ChatTranscript>,
  "activity" | "commands" | "imageSupported" | "updates"
>;

const TaskConversation = memo(function TaskConversation(props: TaskConversationProps) {
  const updates = useTaskSessionUpdates(props.task.id);
  useTaskFileEditCacheSync(props.task.id, updates);
  const activity = useMemo(() => sessionActivity(props.task, updates), [props.task, updates]);
  const commands = useMemo<CommandInfo[]>(() => {
    for (let index = updates.length - 1; index >= 0; index -= 1) {
      const update = updates[index];
      if (update.kind === "available_commands") {
        return update.commands;
      }
    }
    return EMPTY_TASK_COMMANDS;
  }, [updates]);
  const imageSupported = useMemo(() => {
    for (let index = updates.length - 1; index >= 0; index -= 1) {
      const update = updates[index];
      if (update.kind === "prompt_capabilities") {
        return update.image;
      }
    }
    return false;
  }, [updates]);

  return (
    <ChatTranscript
      key={props.task.id}
      {...props}
      activity={activity}
      commands={commands}
      imageSupported={imageSupported}
      updates={updates}
    />
  );
});

export default function TaskDetail({ task, snapshot, onOpenTask, onOpenPush }: Props) {
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
    (query: string): Promise<import("../protocol").SymbolMatch[]> => {
      return daemon.request("file.search", {
        limit: 50,
        query,
        task_id: task.id,
        project: task.project,
      }) as Promise<import("../protocol").SymbolMatch[]>;
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

  // The conversation fills and the workspace is sized, not the other way
  // round, because only a sized panel can fold: folding keeps the pane's
  // content at its old width and merely clips it, so the editors inside are
  // neither remounted nor remeasured when focus mode hides them.
  const chatPane = (
    <Panel key="chat" pin className="min-w-0 px-1">
      {showChat && (
        <Card
          className={cn(
            "relative flex h-full min-h-0 w-full flex-col overflow-hidden border bg-transparent shadow-none",
            !showDiff && "mx-auto max-w-[1100px]",
          )}
        >
          <div className="flex h-9 shrink-0 items-center border-b border-border bg-card px-2">
            <div className="min-w-0 flex-1 truncate text-sm font-semibold">Conversation</div>
            {taskGroup && (
              <TaskAgentSwitcher tree={taskGroup} currentTaskId={task.id} onOpenTask={onOpenTask} />
            )}
            <FocusButton
              focused={!showDiff}
              label={showDiff ? "Focus conversation" : "Restore split view"}
              onClick={() => setShowDiff(!showDiff)}
            />
          </div>
          <AgentLimitsExhaustedBanner agentId={task.agent} />
          <SessionLostBanner task={task} onOpenTask={onOpenTask} />
          <ModelMismatchBanner task={task} />
          <TaskConversation
            active={showChat}
            agents={enabledAgents}
            files={mentionFiles}
            filesLoading={mentionFilesQuery.isLoading}
            composerRef={composerRef}
            onOpenFile={openFileTab}
            onOpenFileDiff={openDiffFile}
            onOpenTask={onOpenTask}
            resolveFilePath={resolveSessionFilePath}
            task={task}
          />
          {foldTarget === "chat" && <PanelCollapseHint label="conversation" />}
        </Card>
      )}
    </Panel>
  );

  const surfacePane = (
    <Panel
      key="surface"
      size={showChat ? workspaceSize : "100%"}
      minSize={WORKSPACE_MIN_WIDTH}
      collapsed={!showDiff}
      onCollapsedChange={(collapsed) => setShowDiff(!collapsed)}
      onSizeChange={handleWorkspaceResize}
      className="min-w-0 px-1"
    >
      <Card className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-none">
        <TaskSurfaceTabs
          activeSurface={activeSurface}
          onSurfaceChange={setActiveSurface}
          tabs={surfaceTabs}
          focused={!showChat}
          focusLabel={showChat ? "Focus workspace" : "Restore split view"}
          onToggleFocus={toggleChat}
          extraActions={
            showChat && <FlipButton chatOnRight={chatOnRight} onClick={toggleChatOnRight} />
          }
        />

        <div className="min-h-0 min-w-0 flex-1">
          {activeSurface === "files" && (
            <FilesSurface
              projectFiles={projectFiles}
              fileListError={fileListError}
              activeFilePath={activeFilePath}
              onSelectTreeFile={openFileTab}
              openTabs={openTabs}
              onSelectTab={(p) => {
                setActiveFilePath(p);
                setGotoLocation((cur) => (cur?.path === p ? cur : null));
              }}
              onCloseTab={closeFileTab}
              fileDoc={fileDoc}
              editable={editable}
              rootPath={projectRoot}
              onRefresh={() => {
                void queryClient.refetchQueries({ queryKey: ["fileList", task.id] });
              }}
              taskId={task.id}
              onSave={(content) =>
                void daemon.request("file.save", {
                  content,
                  path: activeFilePath ?? "",
                  task_id: task.id,
                })
              }
              onGotoDefinition={searchSymbol}
              onOpenSymbol={openSymbol}
              gotoLocation={gotoLocation}
              onGotoLocationHandled={clearGotoLocation}
              onAskFile={sendSelectionToChat}
            />
          )}
          {activeSurface === "diff" && (
            <DiffSurface
              diff={diff}
              diffError={diffError}
              diffView={diffView}
              editable={editable}
              localRes={localRes}
              onOpenFiles={openProjectFiles}
              onResolve={resolveHunk}
              onSendToChat={sendDiffToChat}
              onSetDiffView={setDiffView}
              taskId={task.id}
              project={task.project}
              selected={selectedDiffFile}
              onSelect={openDiffFile}
              onOpenFile={openFileTab}
              commitExpanded={commitExpanded}
              onCommitExpandedChange={setCommitExpanded}
              onCommitted={() => {
                void queryClient.invalidateQueries({ queryKey: ["diff", task.id] });
                void queryClient.invalidateQueries({ queryKey: ["fileList", task.id] });
              }}
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: ["diff", task.id] });
                void queryClient.invalidateQueries({ queryKey: ["fileList", task.id] });
              }}
              diffWorkspaceRef={diffWorkspaceRef}
            />
          )}
          {activeSurface === "runtime" && (
            <RuntimePanel
              project={task.project}
              services={services}
              portforwards={portforwards}
              onAppendToChat={appendLogsToChat}
            />
          )}
          {activeSurface === "terminal" && <TerminalWorkspaceView project={task.project} />}
          {activeSurface === "pipeline" && (
            <PipelineSurface
              task={task}
              childTasks={childTrees}
              agents={enabledAgents}
              onOpenTask={onOpenTask}
            />
          )}
        </div>
        {foldTarget === "workspace" && <PanelCollapseHint label="workspace" />}
      </Card>
    </Panel>
  );

  const separator = (
    <PanelSeparator
      key="sep"
      divider={false}
      className={cn(!(showChat && showDiff) && "pointer-events-none opacity-0")}
      onPointerDown={() => setResizing(true)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div ref={splitRef} className="relative flex min-h-0 flex-1 gap-2">
        <PanelGroup orientation="horizontal" className="min-h-0 flex-1 overflow-hidden">
          {chatOnRight ? [surfacePane, separator, chatPane] : [chatPane, separator, surfacePane]}
        </PanelGroup>
      </div>
      <div className="flex h-4 shrink-0 items-center px-1 text-[10px] text-muted-foreground">
        <span
          className="flex min-w-0 items-center gap-1"
          title={task.worktree ?? "Runs in the local project workspace"}
        >
          <Folder className="size-3 shrink-0" />
          <span>{task.worktree ? "Git Worktree" : "Local Workspace"}</span>
        </span>
        {repositoryOperation && (
          <span className="ml-auto mr-2 flex shrink-0 items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {repositoryOperation.kind === "pull" ? "Pulling from remote…" : "Pushing to remote…"}
          </span>
        )}
        <span className={cn("flex items-center gap-2", !repositoryOperation && "ml-auto")}>
          <GitWorkspaceControls
            taskId={task.id}
            branch={diff?.branch ?? null}
            onOpenCommit={openCommit}
            onOpenPush={onOpenPush}
          />
        </span>
      </div>
    </div>
  );
}
