import { ChevronDown } from "lucide-react";
import { memo, useContext } from "react";

import {
  type TranscriptEntry,
  type TranscriptListRow,
  transcriptRowsAreEqual,
} from "@/lib/sessionStream";
import { cn } from "@/lib/utils";

import { TranscriptRow, TranscriptRowContext } from "./TranscriptRow";

const TranscriptListItem = memo(
  function TranscriptListItem({ row }: { row: TranscriptListRow }) {
    const shared = useContext(TranscriptRowContext);
    if (!shared) throw new Error("Transcript row rendered outside its context");

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

    if (row.kind === "update") {
      return renderEntry(row.entry, row.thinkingActive, row.textStreaming);
    }

    const noun = row.hiddenCount === 1 ? "work update" : "work updates";
    return (
      <button
        type="button"
        aria-expanded={row.expanded}
        onClick={() => shared.onToggleWorkGroup(row.groupId)}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-xs leading-5 text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 opacity-70 transition-transform duration-200",
              row.expanded && "rotate-180",
            )}
          />
        </span>
        {row.expanded ? (
          <span className="font-medium text-foreground/80">Show fewer work updates</span>
        ) : (
          <span className="font-medium text-foreground/80">
            +{row.hiddenCount} previous {noun}
          </span>
        )}
      </button>
    );
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
