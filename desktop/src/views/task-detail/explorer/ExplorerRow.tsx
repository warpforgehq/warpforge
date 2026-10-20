import { ChevronDown, FileText, Loader2 } from "lucide-react";
import { memo, type DragEvent, type MouseEvent } from "react";

import { getFileIconUrl } from "@/lib/fileIcon";
import { cn } from "@/lib/utils";

import type { ExplorerRow as Row, StatusKind } from "./explorerRows";

const STATUS_CLASS: Record<StatusKind, string> = {
  added: "text-ok",
  conflict: "text-destructive",
  deleted: "text-destructive",
  modified: "text-warn",
};

export interface ExplorerRowHandlers {
  onActivate: (event: MouseEvent, row: Row) => void;
  onContextMenu: (event: MouseEvent, row: Row) => void;
  onDragStart: (event: DragEvent, row: Row) => void;
}

/** One line of the Explorer: a file or a folder, positioned by the virtualiser. */
export const ExplorerRow = memo(function ExplorerRow({
  row,
  selected,
  top,
  handlers,
}: {
  row: Row;
  selected: boolean;
  /** Offset from the virtualiser. */
  top: number;
  handlers: ExplorerRowHandlers;
}) {
  const isDir = row.kind === "dir";
  const iconUrl = isDir ? null : getFileIconUrl(row.name);
  const tone = row.status
    ? STATUS_CLASS[row.status]
    : selected
      ? "text-foreground"
      : "text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      data-path={row.path}
      data-status={row.status ?? undefined}
      aria-expanded={isDir ? row.expanded : undefined}
      style={{ paddingLeft: `${row.depth * 12 + 10}px`, transform: `translateY(${top}px)` }}
      onClick={(event) => handlers.onActivate(event, row)}
      onContextMenu={(event) => handlers.onContextMenu(event, row)}
      draggable={!isDir}
      onDragStart={isDir ? undefined : (event) => handlers.onDragStart(event, row)}
      title={row.path}
      className={cn(
        "absolute left-0 top-0 flex h-7 w-full min-w-0 items-center gap-1.5 pr-2 text-left text-xs",
        selected ? "bg-secondary" : "hover:bg-secondary/50",
        tone,
        row.ignored && "opacity-55",
      )}
    >
      {isDir ? (
        row.loading ? (
          <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <ChevronDown
            aria-hidden
            className={cn("size-3.5 shrink-0 transition-transform", !row.expanded && "-rotate-90")}
          />
        )
      ) : iconUrl ? (
        <img src={iconUrl} alt="" aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <FileText aria-hidden className="size-3.5 shrink-0" />
      )}
      <span className={cn("truncate", row.symlink && "italic")}>{row.name}</span>
    </button>
  );
});
