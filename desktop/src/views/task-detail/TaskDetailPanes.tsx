import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { Panel, PanelCollapseHint, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { FlipButton, SurfaceRail } from "@/components/workspace";
import { setTaskDiff, setTaskEditorView, setTaskFiles } from "@/lib/sessionStore";
import { cn } from "@/lib/utils";

import { AgentLimitsExhaustedBanner } from "../../components/AgentLimitsExhaustedBanner";
import { ModelMismatchBanner } from "../../components/ModelMismatchBanner";
import { TerminalWorkspaceView } from "../../components/runtime/TerminalWorkspace";
import { RuntimePanel } from "../../components/RuntimePanel";
import { SessionLostBanner } from "../../components/SessionLostBanner";
import { TaskAgentSwitcher } from "../../components/TaskAgentSwitcher";
import { daemon } from "../../daemon";
import type { TaskInfo } from "../../protocol";
import { BrowserSurface } from "./browser/BrowserSurface";
import { DiffSurface } from "./DiffSurface";
import { FilesSurface } from "./FilesSurface";
import { PipelineSurface } from "./PipelineSurface";
import { TaskConversation } from "./TaskConversation";
import { TaskConversationHeader } from "./TaskConversationHeader";
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
    chatOnRight,
    toggleChatOnRight,
    workspaceSize,
    setResizing,
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
    projectFiles,
    fileListError,
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
    appendLogsToChat,
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
    <Panel key="chat" pin className="min-w-0 px-1">
      {showChat && (
        <Card
          className={cn(
            "relative flex h-full min-h-0 w-full flex-col overflow-hidden border bg-transparent shadow-none",
            !showDiff && "mx-auto max-w-[1100px]",
          )}
        >
          <TaskConversationHeader
            showDiff={showDiff}
            setShowDiff={setShowDiff}
            toggleChat={toggleChat}
            side={chatOnRight ? "right" : "left"}
            extraActions={
              taskGroup && (
                <TaskAgentSwitcher
                  tree={taskGroup}
                  currentTaskId={task.id}
                  onOpenTask={onOpenTask}
                />
              )
            }
          />
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
      // Folding drives the panel's width to zero, but its gutter and the card's
      // own two edges survive it and read as a seam beside the conversation.
      className={cn("min-w-0", showDiff ? "px-1" : "px-0")}
    >
      <Card
        className={cn(
          "relative flex h-full min-h-0 flex-col overflow-hidden border bg-card shadow-none",
          showDiff ? "border-border" : "border-transparent",
        )}
      >
        <TaskSurfaceHeader
          activeSurface={activeSurface}
          tabs={surfaceTabs}
          workspaceFocused={!showChat}
          onFocusWorkspace={toggleChat}
          onHideSurface={() => setShowDiff(false)}
          onRestore={toggleChat}
          side={chatOnRight ? "left" : "right"}
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
              initialScrollTop={taskSession.diff.scrollTop}
              onScrollTopChange={(scrollTop) =>
                setTaskDiff(task.id, task.project, { scrollTop }, task.worktree ?? undefined)
              }
              collapsedFiles={collapsedDiffFiles}
              onToggleCollapsed={toggleDiffFileCollapsed}
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
          {activeSurface === "browser" && <BrowserSurface project={task.project} />}
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
            {chatOnRight ? [surfacePane, separator, chatPane] : [chatPane, separator, surfacePane]}
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
        />
      </div>
      <TaskStatusStrip
        task={task}
        branch={diff?.branch ?? null}
        repositoryOperation={repositoryOperation}
        onOpenCommit={openCommit}
        onOpenPush={onOpenPush}
      />
    </div>
  );
}
