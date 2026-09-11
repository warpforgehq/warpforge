import { createContext, memo, useMemo, useRef, type MouseEvent } from "react";

import type { FileLinkResolver } from "@/components/Markdown";

import { showContextMenu, useNativeContextMenu } from "../../hooks/useNativeContextMenu";
import type { AgentConfig, EditHunk, SessionUpdate } from "../../protocol";
import { StreamLine } from "../../views/mission-control/StreamLine";
import { MessageActions } from "../MessageActions";

export interface TranscriptRowContextValue {
  agents: AgentConfig[];
  onOpenFile: (path: string) => void;
  onOpenFileDiff: (path: string, hunks?: EditHunk[]) => void;
  onOpenTask: (id: string) => void;
  onRequestBranch: (agent: string, throughIndex: number) => void;
  onToggleWorkGroup: (id: string) => void;
  project: string;
  resolveFilePath: FileLinkResolver;
  resolved: Record<string, string>;
  taskId: string;
}

export const TranscriptRowContext = createContext<TranscriptRowContextValue | null>(null);

export const TranscriptRow = memo(function TranscriptRow({
  update,
  thinkingActive,
  textStreaming,
  taskId,
  resolved,
  resolveFilePath,
  onOpenFile,
  onOpenFileDiff,
  agents,
  branchIndex,
  onOpenTask,
  onRequestBranch,
  project,
}: {
  update: SessionUpdate;
  thinkingActive: boolean;
  textStreaming: boolean;
  taskId: string;
  resolved: Record<string, string>;
  resolveFilePath: FileLinkResolver;
  onOpenFile: (path: string) => void;
  onOpenFileDiff: (path: string, hunks?: EditHunk[]) => void;
  agents: AgentConfig[];
  branchIndex: number;
  onOpenTask: (id: string) => void;
  onRequestBranch: (agent: string, throughIndex: number) => void;
  project: string;
}) {
  const continueConversation = async (agent: string) => {
    onRequestBranch(agent, branchIndex);
  };
  const messageText =
    update.kind === "user_message" || update.kind === "agent_text" ? update.text : null;

  const requestId = useRef(`message-${crypto.randomUUID()}`).current;
  const copyHandler = useMemo(
    () =>
      messageText
        ? new Map([["copy", () => void navigator.clipboard.writeText(messageText)]])
        : new Map<string, () => void>(),
    [messageText],
  );
  useNativeContextMenu(requestId, copyHandler);

  const onRowContextMenu = (e: MouseEvent) => {
    if (!messageText) return;
    e.preventDefault();
    e.stopPropagation();
    void showContextMenu({
      requestId,
      items: [{ type: "item", id: "copy", label: "Copy Message" }],
    });
  };

  return (
    <div className="group/message relative" onContextMenu={onRowContextMenu}>
      <StreamLine
        update={update}
        thinkingActive={thinkingActive}
        textStreaming={textStreaming}
        taskId={taskId}
        resolved={resolved}
        resolveFilePath={resolveFilePath}
        onOpenFile={onOpenFile}
        onOpenFileDiff={onOpenFileDiff}
        onOpenTask={onOpenTask}
        project={project}
      />
      {messageText && (
        <div className="absolute right-0 bottom-0 z-10">
          <MessageActions agents={agents} text={messageText} onContinue={continueConversation} />
        </div>
      )}
    </div>
  );
});
