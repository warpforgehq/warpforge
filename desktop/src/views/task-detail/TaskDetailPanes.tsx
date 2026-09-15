import { Folder, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { Panel, PanelCollapseHint, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { FlipButton, FocusButton, PaneHeader } from "@/components/workspace";
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
import { DiffSurface } from "./DiffSurface";
import { FilesSurface } from "./FilesSurface";
import { GitWorkspaceControls } from "./GitWorkspaceControls";
import { PipelineSurface } from "./PipelineSurface";
import { TaskConversation } from "./TaskConversation";
import { TaskSurfaceTabs } from "./TaskSurfaceTabs";
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
          <PaneHeader
            title="Conversation"
            actions={
              <>
                {taskGroup && (
                  <TaskAgentSwitcher
                    tree={taskGroup}
                    currentTaskId={task.id}
                    onOpenTask={onOpenTask}
                  />
                )}
                <FocusButton
                  focused={!showDiff}
                  label={showDiff ? "Focus conversation" : "Restore split view"}
                  onClick={() => setShowDiff(!showDiff)}
                />
              </>
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
      <div className="flex h-4 shrink-0 items-center px-1 text-[11px] text-muted-foreground">
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
