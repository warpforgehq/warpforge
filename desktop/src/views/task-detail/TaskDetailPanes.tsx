import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { TaskPullRequestSurface } from "@/components/pullRequest/TaskPullRequestSurface";
import { TaskAccountMenu } from "@/components/TaskAccountMenu";
import { Card } from "@/components/ui/card";
import { Panel, PanelCollapseHint, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { PaneWindowControls, SurfaceRail } from "@/components/workspace";
import { daemon } from "@/daemon";
import { saveFile } from "@/lib/saveFile";
import { setTaskDiff, setTaskEditorView, setTaskFiles } from "@/lib/sessionStore";
import { cn } from "@/lib/utils";
import { useTitleRow } from "@/store/titleRow";

import { AgentLimitsExhaustedBanner } from "../../components/AgentLimitsExhaustedBanner";
import { DiffNotesProvider } from "../../components/diffNotes/DiffNotesContext";
import { KeepersSurface } from "../../components/keepers/KeepersSurface";
import { ModelMismatchBanner } from "../../components/ModelMismatchBanner";
import { PrFeedbackNotice } from "../../components/pullRequest/PrFeedbackNotice";
import { TerminalWorkspaceView } from "../../components/runtime/TerminalWorkspace";
import { RuntimePanel } from "../../components/RuntimePanel";
import { SessionLostBanner } from "../../components/SessionLostBanner";
import { TaskAgentSwitcher } from "../../components/TaskAgentSwitcher";
import type { TaskInfo } from "../../protocol";
import { BrowserSurface } from "./browser/BrowserSurface";
import { DiffSurface } from "./DiffSurface";
import { FilesSurface } from "./FilesSurface";
import { PipelineSurface } from "./PipelineSurface";
import { TaskConversation } from "./TaskConversation";
import { TaskRailMenu } from "./TaskRailMenu";
import { TaskStatusStrip } from "./TaskStatusStrip";
import { TaskSurfaceHeader } from "./TaskSurfaceHeader";
import { useTaskDetail, WORKSPACE_MIN_WIDTH } from "./useTaskDetail";

interface Props {
  task: TaskInfo;
  onOpenTask: (id: string) => void;
  onOpenPush: () => void;
  detail: ReturnType<typeof useTaskDetail>;
}

export function TaskDetailPanes({ task, onOpenTask, onOpenPush, detail }: Props) {
  const {
    activeSurface,
    setActiveSurface,
    showChat,
    showDiff,
    setShowDiff,
    toggleChat,
    workspaceSize,
    setResizing,
    resizing,
    foldTarget,
    splitRef,
    activeFilePath,
    setActiveFilePath,
    gotoLocation,
    setGotoLocation,
    selectedDiffFile,
    commitExpanded,
    setCommitExpanded,
    localRes,
    diffView,
    setDiffView,
    taskGroup,
    enabledAgents,
    repositoryOperation,
    services,
    portforwards,
    composerRef,
    diffWorkspaceRef,
    editable,
    mentionFiles,
    mentionFilesQuery,
    fileDoc,
    queryClient,
    diff,
    diffError,
    openTabs,
    projectRoot,
    childTrees,
    surfaceTabs,
    openCommit,
    openFileTab,
    searchSymbol,
    openSymbol,
    clearGotoLocation,
    openDiffFile,
    closeFileTab,
    resolveHunk,
    openProjectFiles,
    sendDiffToChat,
    attachLogsToChat,
    attachBrowserContext,
    setBrowserContextImage,
    sendSelectionToChat,
    resolveSessionFilePath,
    handleWorkspaceResize,
    taskSession,
  } = detail;

  const treeState = useMemo(
    () => ({
      expandedDirs: taskSession.files.expandedDirs,
      onChange: (next: { expandedDirs: string[]; scrollTop: number; scrollLeft: number }) =>
        setTaskFiles(
          task.id,
          task.project,
          {
            expandedDirs: next.expandedDirs,
            treeScrollLeft: next.scrollLeft,
            treeScrollTop: next.scrollTop,
          },
          task.worktree ?? undefined,
        ),
      scrollLeft: taskSession.files.treeScrollLeft,
      scrollTop: taskSession.files.treeScrollTop,
    }),
    [
      task.id,
      task.project,
      task.worktree,
      taskSession.files.expandedDirs,
      taskSession.files.treeScrollLeft,
      taskSession.files.treeScrollTop,
    ],
  );

  const collapsedDiffFiles = useMemo(
    () => new Set(taskSession.diff.collapsedFiles),
    [taskSession.diff.collapsedFiles],
  );
  const titleSlot = useTitleRow((state) => state.slot);
  const surfaceSlot = useTitleRow((state) => state.surfaceSlot);
  const metaSlot = useTitleRow((state) => state.metaSlot);
  const paneSlot = useTitleRow((state) => state.paneSlot);
  const setPaneFull = useTitleRow((state) => state.setPaneFull);
  const paneFull = showDiff && !showChat;
  useEffect(() => {
    setPaneFull(paneFull);
    return () => setPaneFull(false);
  }, [paneFull, setPaneFull]);
  const setSplitHot = useTitleRow((state) => state.setSplitHot);
  const [separatorHovered, setSeparatorHovered] = useState(false);
  useEffect(() => {
    setSplitHot(separatorHovered || resizing);
    return () => setSplitHot(false);
  }, [separatorHovered, resizing, setSplitHot]);
  const setSplitX = useTitleRow((state) => state.setSplitX);
  const splitEdgeRef = useRef<HTMLDivElement>(null);
  const split = showChat && showDiff;
  useLayoutEffect(() => {
    const edge = splitEdgeRef.current;
    if (!split || !edge) {
      setSplitX(null);
      return;
    }
    // The 1px separator sits right before the pane; its left edge is the line.
    const publish = () => setSplitX(edge.getBoundingClientRect().left - 1);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(edge);
    if (splitRef.current) observer.observe(splitRef.current);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      setSplitX(null);
    };
  }, [split, setSplitX, splitRef]);

  const toggleDiffFileCollapsed = (path: string) => {
    const next = new Set(taskSession.diff.collapsedFiles);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setTaskDiff(task.id, task.project, { collapsedFiles: [...next] }, task.worktree ?? undefined);
  };

  // The conversation fills and the workspace is sized, not the other way
  // round, because only a sized panel can fold: folding keeps the pane's
  // content at its old width and merely clips it, so the editors inside are
  // neither remounted nor remeasured when focus mode hides them.
  const chatPane = (
    <Panel key="chat" pin className="min-w-0">
      {showChat && (
        <Card
          className={cn(
            "relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none",
            !showDiff && "mx-auto max-w-[1100px]",
          )}
        >
          {titleSlot &&
            taskGroup &&
            createPortal(
              <TaskAgentSwitcher
                tree={taskGroup}
                currentTaskId={task.id}
                onOpenTask={onOpenTask}
              />,
              titleSlot,
            )}
          <AgentLimitsExhaustedBanner agentId={task.agent} />
          <SessionLostBanner task={task} onOpenTask={onOpenTask} />
          <ModelMismatchBanner task={task} />
          <PrFeedbackNotice task={task} />
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
      // Folding drives the panel's width to zero, but its gutter and the card's
      // own two edges survive it and read as a seam beside the conversation.
      className="min-w-0"
    >
      <Card
        ref={splitEdgeRef}
        className={cn(
          "relative flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none",
        )}
      >
        {surfaceSlot &&
          showDiff &&
          createPortal(
            <TaskSurfaceHeader
              className="h-full flex-1 border-0 px-0 pr-2"
              activeSurface={activeSurface}
              tabs={surfaceTabs}
            />,
            surfaceSlot,
          )}
        {paneSlot &&
          showDiff &&
          createPortal(
            <PaneWindowControls
              focused={!showChat}
              side="right"
              expandLabel="Focus workspace"
              hideLabel="Hide surface"
              onExpand={toggleChat}
              onHide={() => setShowDiff(false)}
              onRestore={toggleChat}
            />,
            paneSlot,
          )}
        <div className="min-h-0 min-w-0 flex-1">
          {activeSurface === "files" && (
            <FilesSurface
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
                saveFile({
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
              restoreView={
                activeFilePath ? (taskSession.files.views[activeFilePath] ?? null) : null
              }
              onViewChange={(position) => {
                if (activeFilePath) {
                  setTaskEditorView(
                    task.id,
                    task.project,
                    activeFilePath,
                    position,
                    task.worktree ?? undefined,
                  );
                }
              }}
              treeState={treeState}
              treeResetKey={task.id}
            />
          )}
          {activeSurface === "diff" && (
            <DiffNotesProvider key={task.id} task={task}>
              <DiffSurface
                task={task}
                diff={diff}
                diffError={diffError}
                diffView={diffView}
                editable={editable}
                localRes={localRes}
                onOpenFiles={openProjectFiles}
                onResolve={resolveHunk}
                onSendToChat={sendDiffToChat}
                onSetDiffView={setDiffView}
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
                initialScrollTop={taskSession.diff.scrollTop}
                onScrollTopChange={(scrollTop) =>
                  setTaskDiff(task.id, task.project, { scrollTop }, task.worktree ?? undefined)
                }
                collapsedFiles={collapsedDiffFiles}
                onToggleCollapsed={toggleDiffFileCollapsed}
              />
            </DiffNotesProvider>
          )}
          {activeSurface === "pull-request" && <TaskPullRequestSurface task={task} />}
          {activeSurface === "keepers" && <KeepersSurface task={task} onOpenFile={openFileTab} />}
          {activeSurface === "runtime" && (
            <RuntimePanel
              project={task.project}
              services={services}
              portforwards={portforwards}
              onAppendToChat={attachLogsToChat}
            />
          )}
          {activeSurface === "terminal" && (
            <TerminalWorkspaceView project={task.project} taskId={task.id} />
          )}
          {activeSurface === "browser" && (
            <BrowserSurface
              project={task.project}
              services={services}
              onAnnotate={attachBrowserContext}
              onShot={setBrowserContextImage}
            />
          )}
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
      className={cn("before:hidden", !(showChat && showDiff) && "pointer-events-none opacity-0")}
      onPointerDown={() => setResizing(true)}
      onPointerEnter={() => setSeparatorHovered(true)}
      onPointerLeave={() => setSeparatorHovered(false)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* The rail stays outside the drag track: `splitRef`'s rect is what the
            fold threshold is measured against.

            `min-w-0` on every layer is load-bearing, not tidiness: a sized
            panel with `size="100%"` refits to its parent's measured width on
            every parent resize, and a flex item left at `min-width: auto`
            would answer that measurement with a larger min-content width, so
            the group grew a little on each observer tick and ran off the right
            edge of the window while the workspace owned the split. */}
        <div ref={splitRef} className="relative flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden">
          <PanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {[chatPane, separator, surfacePane]}
          </PanelGroup>
        </div>
        <SurfaceRail
          tabs={surfaceTabs}
          activeSurface={activeSurface}
          onSurfaceChange={(surface) => {
            setActiveSurface(surface);
            if (!showDiff) setShowDiff(true);
          }}
          chatVisible={showChat}
          surfaceVisible={showDiff}
          onConversation={() => {
            if (!showChat) toggleChat();
            else setShowDiff(false);
          }}
          footer={
            <div className="flex flex-col items-center gap-2">
              <TaskRailMenu task={task} />
              <TaskAccountRing agentId={task.agent} />
            </div>
          }
        />
      </div>
      {metaSlot &&
        createPortal(
          <TaskStatusStrip
            task={task}
            branch={diff?.branch ?? null}
            repositoryOperation={repositoryOperation}
            onOpenCommit={openCommit}
            onOpenPush={onOpenPush}
          />,
          metaSlot,
        )}
    </div>
  );
}

function TaskAccountRing({ agentId }: { agentId: string }) {
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  return (
    <TaskAccountMenu
      variant="ring"
      agentId={agentId}
      agents={snapshot.agents ?? []}
      accounts={snapshot.accounts ?? []}
    />
  );
}
