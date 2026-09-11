import type { EditorView } from "@codemirror/view";
import { ArrowDown, ArrowUp, Copy, Loader2, Undo2 } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ChangeBlock, DeletedBlock } from "@/lib/changeGutter";

export function ChangePopup({
  activeChange,
  commitMsg,
  setCommitMsg,
  committing,
  commitActive,
  revertActive,
  navigateChange,
  viewRef,
  onClose,
}: {
  activeChange: { block: ChangeBlock | DeletedBlock; line: number; x: number; y: number };
  commitMsg: string;
  setCommitMsg: Dispatch<SetStateAction<string>>;
  committing: boolean;
  commitActive: () => void;
  revertActive: () => void;
  navigateChange: (dir: 1 | -1) => void;
  viewRef: RefObject<EditorView | null>;
  onClose: () => void;
}) {
  return (
    <div
      data-change-popup
      className="absolute z-30 flex min-w-[340px] max-w-[560px] flex-col overflow-hidden rounded-md border bg-popover shadow-lg"
      style={{ left: Math.min(activeChange.x, 24), top: activeChange.y + 18 }}
    >
      <div className="flex items-center gap-1 border-b bg-background px-2 py-1.5">
        <button
          type="button"
          title="Previous change"
          onClick={() => navigateChange(-1)}
          className="rounded p-1 hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          title="Next change"
          onClick={() => navigateChange(1)}
          className="rounded p-1 hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowDown className="size-3.5" />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={revertActive}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
          title="Revert this change"
        >
          <Undo2 className="size-3" /> Revert
        </button>
        <button
          type="button"
          onClick={() => {
            const text =
              activeChange.block.type === "deleted"
                ? (activeChange.block as DeletedBlock).oldText
                : (activeChange.block as ChangeBlock).type === "added"
                  ? (viewRef.current?.state.sliceDoc(
                      viewRef.current.state.doc.line((activeChange.block as ChangeBlock).from).from,
                      viewRef.current.state.doc.line((activeChange.block as ChangeBlock).to).to,
                    ) ?? "")
                  : (activeChange.block as ChangeBlock).oldText;
            if (text) void navigator.clipboard.writeText(text);
          }}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
          title="Copy changed fragment to clipboard"
        >
          <Copy className="size-3" /> Copy
        </button>
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          {activeChange.block.type === "deleted"
            ? `line ${activeChange.line} • deleted`
            : `lines ${(activeChange.block as ChangeBlock).from}-${(activeChange.block as ChangeBlock).to} • ${(activeChange.block as ChangeBlock).type}`}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-1 rounded px-1 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>
      {activeChange.block.type === "deleted" && (
        <div className="max-h-32 overflow-auto border-y bg-muted/30 p-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-4 text-foreground">
            {(activeChange.block as DeletedBlock).oldText.slice(0, 800) || "(empty)"}
          </pre>
        </div>
      )}
      {activeChange.block.type !== "deleted" && (activeChange.block as ChangeBlock).oldText && (
        <div className="max-h-24 overflow-auto border-y bg-muted/30 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Previous •{" "}
            {(activeChange.block as ChangeBlock).type === "added" ? "new lines" : "modified"}
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-4 text-muted-foreground">
            {(activeChange.block as ChangeBlock).oldText.slice(0, 600)}
          </pre>
        </div>
      )}
      <div className="flex items-center gap-2 p-2">
        <input
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void commitActive();
            }
          }}
          placeholder="Commit this change"
          className="flex-1 rounded border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
          autoFocus
        />
        <button
          type="button"
          onClick={() => void commitActive()}
          disabled={!commitMsg.trim() || committing}
          className="flex h-7 items-center gap-1 rounded bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
        >
          {committing ? <Loader2 className="size-3 animate-spin" /> : <span>↵</span>}
        </button>
      </div>
    </div>
  );
}
