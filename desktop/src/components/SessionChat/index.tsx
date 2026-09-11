import { LegendList } from "@legendapp/list/react";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContinueSessionDialog } from "@/components/ContinueSessionDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionHistory } from "@/hooks/useSessionHistory";
import type { SessionActivity } from "@/lib/sessionActivity";
import {
  deriveTranscriptRows,
  hasReconnectingTransient,
  type TranscriptListRow,
  transcriptRowsAreEqual,
} from "@/lib/sessionStream";
import { activeThinkingIndex } from "@/lib/sessionThinking";
import { latestContextUsage } from "@/lib/sessionUsage";

import { daemon } from "../../daemon";
import { useWorkflowSend } from "../../hooks/useWorkflowSend";
import type {
  AgentConfig,
  CommandInfo,
  EditHunk,
  ProjectFile,
  PromptSubmission,
  SessionUpdate,
  TaskInfo,
} from "../../protocol";
import { AgentActivityIndicator } from "../AgentActivityIndicator";
import { AgentConfigBar } from "../AgentConfigBar";
import type { ComposerHandle } from "../Composer";
import { Composer } from "../Composer";
import { WorkflowControls } from "../WorkflowControls";
import {
  CHAT_DRAW_DISTANCE_PX,
  CHAT_ESTIMATED_ROW_PX,
  CHAT_LIST_EMPTY,
  CHAT_LIST_FOOTER,
  CHAT_LIST_HEADER,
  CHAT_MAINTAIN_SCROLL_AT_END,
  CHAT_MAINTAIN_SCROLL_AT_END_THRESHOLD,
} from "./constants";
import { renderTranscriptItem, transcriptRowKey, transcriptRowType } from "./TranscriptList";
import { TranscriptRowContext, type TranscriptRowContextValue } from "./TranscriptRow";
import { useStableResolved } from "./useStableResolved";
import { useTranscriptFollow } from "./useTranscriptFollow";

export interface SessionChatProps {
  activity: SessionActivity | null;
  active: boolean;
  commands: CommandInfo[];
  composerRef: React.Ref<ComposerHandle>;
  files: ProjectFile[];
  filesLoading: boolean;
  imageSupported: boolean;
  onOpenFile: (path: string) => void;
  onOpenFileDiff: (path: string, hunks?: EditHunk[]) => void;
  resolveFilePath: (value: string) => string | null;
  task: TaskInfo;
  updates: SessionUpdate[];
  agents: AgentConfig[];
  onOpenTask: (id: string) => void;
  /**
   * Render the transcript without the composer. Used where a *different*
   * task's session is on show — the Pipeline surface watching a child agent —
   * so the reader can see what it is doing without being offered a reply box
   * that would steer a session they are not in.
   */
  readOnly?: boolean;
}

export function SessionChat({
  activity,
  active,
  commands,
  composerRef,
  files,
  filesLoading,
  imageSupported,
  onOpenFile,
  onOpenFileDiff,
  resolveFilePath,
  task,
  updates,
  agents,
  onOpenTask,
  readOnly = false,
}: SessionChatProps) {
  // The transcript is fetched per task on open and the list mounts only once
  // it has resolved in full — a mounted transcript is only ever appended to
  // (docs/adr/0005).
  const historyResolved = useSessionHistory(task.id);
  const merged = updates;
  const contextUsage = useMemo(() => latestContextUsage(updates), [updates]);
  const thinkingIndex = useMemo(() => {
    if (activeThinkingIndex(updates, task.status) === null) return null;
    for (let index = merged.length - 1; index >= 0; index--) {
      if (merged[index].kind === "agent_thought") return index;
    }
    return null;
  }, [merged, task.status, updates]);
  const streamingTextIndex = useMemo(() => {
    if (task.status !== "running") return null;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const kind = merged[index].kind;
      if (kind === "usage" || kind === "available_commands" || kind === "prompt_capabilities") {
        continue;
      }
      return kind === "agent_text" ? index : null;
    }
    return null;
  }, [merged, task.status]);
  const resolved = useStableResolved(updates);
  // Which message the developer asked to continue from, and with what. The
  // dialog it opens decides how much of the conversation travels.
  const [branchRequest, setBranchRequest] = useState<{
    agent: string;
    throughIndex: number;
  } | null>(null);
  const requestBranch = useCallback((agent: string, throughIndex: number) => {
    setBranchRequest({ agent, throughIndex });
  }, []);
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const disclosureAnchorKey = useRef<string | null>(null);
  const [disclosureSettling, setDisclosureSettling] = useState(false);
  const disclosureFrames = useRef<number[]>([]);
  const suspendForDisclosure = useCallback((anchorKey: string) => {
    disclosureAnchorKey.current = anchorKey;
    setDisclosureSettling(true);
    // Cancel any in-flight settle from a prior rapid toggle before starting a
    // new one; otherwise an old frame's clear wins and the new toggle settles
    // early, re-enabling end-pin while content is still resizing.
    disclosureFrames.current.forEach(cancelAnimationFrame);
    disclosureFrames.current = [
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          disclosureAnchorKey.current = null;
          setDisclosureSettling(false);
          disclosureFrames.current = [];
        });
      }),
    ];
  }, []);
  useEffect(() => {
    return () => disclosureFrames.current.forEach(cancelAnimationFrame);
  }, []);
  const toggleWorkGroup = useCallback(
    (id: string) => {
      // Anchor compensation to the toggled row's own id so the trigger stays
      // under the pointer instead of the viewport chasing the end. The toggle
      // row's id is `work-toggle:${groupId}` (sessionStream.ts:127), and
      // `shouldRestorePosition` compares against row.id.
      suspendForDisclosure(`work-toggle:${id}`);
      setExpandedWorkGroups((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [suspendForDisclosure],
  );
  const transcriptRows = useMemo(
    () => deriveTranscriptRows(merged, expandedWorkGroups, thinkingIndex, streamingTextIndex),
    [expandedWorkGroups, merged, streamingTextIndex, thinkingIndex],
  );
  const rowContext = useMemo<TranscriptRowContextValue>(
    () => ({
      agents,
      onOpenFile,
      onOpenFileDiff,
      onOpenTask,
      onRequestBranch: requestBranch,
      onToggleWorkGroup: toggleWorkGroup,
      project: task.project,
      resolveFilePath,
      resolved,
      taskId: task.id,
    }),
    [
      agents,
      requestBranch,
      onOpenFile,
      onOpenFileDiff,
      onOpenTask,
      resolveFilePath,
      resolved,
      task.id,
      task.project,
      toggleWorkGroup,
    ],
  );
  const {
    listRef,
    following,
    maintainVisibleContentPosition,
    onTranscriptScroll,
    onWheelCapture,
    onTouchStartCapture,
    onTouchMoveCapture,
    pauseFollowingOnNavigationKey,
    resumeLatest,
  } = useTranscriptFollow({
    active,
    taskId: task.id,
    disclosureSettling,
    disclosureAnchorKey,
  });

  const workflow = useWorkflowSend(task);

  const onSend = useCallback(
    async (submission: PromptSubmission) => {
      resumeLatest();
      if (await workflow.send(submission)) return;
      await daemon.request("session.prompt", { task_id: task.id, ...submission });
    },
    [resumeLatest, task.id, workflow],
  );

  const onCancel = useCallback(async () => {
    await daemon.request("task.cancel", { task_id: task.id });
  }, [task.id]);

  const isRunning = task.status === "running" || task.status === "queued";

  return (
    <>
      {branchRequest && (
        <ContinueSessionDialog
          open
          onOpenChange={(next) => {
            if (!next) setBranchRequest(null);
          }}
          task={task}
          updates={merged}
          throughIndex={branchRequest.throughIndex}
          targetAgent={branchRequest.agent}
          onOpenTask={onOpenTask}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <TranscriptRowContext.Provider value={rowContext}>
          {historyResolved ? (
            <LegendList<TranscriptListRow>
              ref={listRef}
              data={transcriptRows}
              keyExtractor={transcriptRowKey}
              getItemType={transcriptRowType}
              itemsAreEqual={transcriptRowsAreEqual}
              renderItem={renderTranscriptItem}
              recycleItems
              drawDistance={CHAT_DRAW_DISTANCE_PX}
              estimatedItemSize={CHAT_ESTIMATED_ROW_PX}
              initialScrollAtEnd
              maintainScrollAtEnd={
                following && !disclosureSettling ? CHAT_MAINTAIN_SCROLL_AT_END : false
              }
              maintainScrollAtEndThreshold={CHAT_MAINTAIN_SCROLL_AT_END_THRESHOLD}
              maintainVisibleContentPosition={maintainVisibleContentPosition}
              onScroll={onTranscriptScroll}
              onWheelCapture={onWheelCapture}
              onTouchStartCapture={onTouchStartCapture}
              onTouchMoveCapture={onTouchMoveCapture}
              onKeyDown={pauseFollowingOnNavigationKey}
              tabIndex={0}
              className="scrollbar-gutter-both h-full min-w-0 overflow-x-hidden overscroll-y-contain px-2 text-sm [overflow-anchor:none]"
              ListHeaderComponent={CHAT_LIST_HEADER}
              ListFooterComponent={CHAT_LIST_FOOTER}
              ListEmptyComponent={CHAT_LIST_EMPTY}
            />
          ) : (
            <div
              role="status"
              aria-label="Loading conversation"
              className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <span className="size-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
              Loading conversation…
            </div>
          )}
        </TranscriptRowContext.Provider>
        {!following && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute bottom-3 right-2 z-20 size-9 rounded-full bg-background text-muted-foreground shadow-sm hover:text-foreground"
                aria-label="Scroll to latest message"
                onClick={resumeLatest}
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Latest message</TooltipContent>
          </Tooltip>
        )}
      </div>
      {hasReconnectingTransient(updates) && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
          Reconnecting to the saved agent session…
        </div>
      )}
      {/* No bottom padding on the activity line: the composer's own `py-2` is
          the gap. Stacking both put 14px between the status line and the box
          it describes. */}
      {activity && (
        <div className="shrink-0 px-2 pb-0 pt-1.5">
          <AgentActivityIndicator activity={activity} compact />
        </div>
      )}
      {task.workflowRun && !readOnly && <WorkflowControls task={task} />}
      {!readOnly && (
        <div>
          <Composer
            // One left edge down the whole column: the header title, every
            // message and the composer all start at px-3. With no frame around
            // the conversation, three different insets is what read as slop.
            className="px-2"
            ref={composerRef}
            commands={commands}
            contextUsage={contextUsage}
            files={files}
            filesLoading={filesLoading}
            imageSupported={imageSupported}
            disabled={task.status === "done" || workflow.disabled}
            onSend={onSend}
            onCancel={isRunning && !workflow.isWorkflow ? onCancel : undefined}
            placeholder={workflow.placeholder ?? "Steer this session..."}
            toolbar={
              task.configOptions && task.configOptions.length > 0 ? (
                <AgentConfigBar taskId={task.id} options={task.configOptions} />
              ) : undefined
            }
          />
        </div>
      )}
    </>
  );
}
