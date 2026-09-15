import { memo, useContext } from "react";

import {
  type TranscriptEntry,
  type TranscriptListRow,
  transcriptRowsAreEqual,
} from "@/lib/sessionStream";
import { cn } from "@/lib/utils";

import { ActivityGroup } from "./ActivityGroup";
import { TranscriptRow, TranscriptRowContext } from "./TranscriptRow";

const TranscriptListItem = memo(
  function TranscriptListItem({ row }: { row: TranscriptListRow }) {
    const shared = useContext(TranscriptRowContext);
    if (!shared) throw new Error("Transcript row rendered outside its context");

    if (row.kind === "activity") {
      return <ActivityGroup row={row} />;
    }

    const renderEntry = (
      entry: TranscriptEntry,
      thinkingActive: boolean,
      textStreaming: boolean,
    ) => (
      <TranscriptRow
        update={entry.update}
        thinkingActive={thinkingActive}
        textStreaming={textStreaming}
        taskId={shared.taskId}
        resolved={shared.resolved}
        resolveFilePath={shared.resolveFilePath}
        onOpenFile={shared.onOpenFile}
        onOpenFileDiff={shared.onOpenFileDiff}
        agents={shared.agents}
        branchIndex={entry.mergedIndex}
        onOpenTask={shared.onOpenTask}
        onRequestBranch={shared.onRequestBranch}
        project={shared.project}
      />
    );

    return renderEntry(row.entry, row.thinkingActive, row.textStreaming);
  },
  (previous, next) => transcriptRowsAreEqual(previous.row, next.row),
);

export function renderTranscriptItem({ item }: { item: TranscriptListRow }) {
  const isUser = item.kind === "update" && item.entry.update.kind === "user_message";
  return (
    <div
      key={item.id}
      className={cn(
        "min-w-0 overflow-x-clip pb-3",
        isUser ? "ml-auto max-w-[90%] w-full" : "mx-auto w-full",
      )}
    >
      <TranscriptListItem row={item} />
    </div>
  );
}

export function transcriptRowKey(row: TranscriptListRow) {
  return row.id;
}

export function transcriptRowType(row: TranscriptListRow) {
  return row.kind === "update" ? `update:${row.entry.update.kind}` : row.kind;
}
