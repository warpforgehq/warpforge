import { Check, Code, Eye, Loader2, Save, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { LSP_LABELS, type SaveStatus } from "./constants";

export function EditorToolbar({
  path,
  status,
  markdown,
  htmlDoc,
  svgImage,
  preview,
  onTogglePreview,
  isReadOnly,
  editable,
  onSave,
  lspMissing,
  lspInstallBusy,
  onInstallLsp,
}: {
  path: string;
  status: SaveStatus;
  markdown: boolean;
  htmlDoc: boolean;
  svgImage: boolean;
  preview: boolean;
  onTogglePreview: () => void;
  isReadOnly: boolean;
  editable: boolean;
  onSave: () => void;
  lspMissing: string | null;
  lspInstallBusy: boolean;
  onInstallLsp: () => void;
}) {
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-3 border-b px-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
        <span
          className={cn(
            "flex items-center gap-1",
            status === "unsaved" && "text-warn",
            status === "saved" && "text-ok",
          )}
        >
          {status === "unsaved" ? (
            "unsaved"
          ) : status === "saved" ? (
            <>
              <Check className="size-3" /> saved
            </>
          ) : null}
        </span>
        {(markdown || htmlDoc || svgImage) && (
          <button
            type="button"
            onClick={onTogglePreview}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary hover:text-foreground"
          >
            {preview ? (
              <>
                <Code className="size-3" /> source
              </>
            ) : (
              <>
                <Eye className="size-3" /> preview
              </>
            )}
          </button>
        )}
        {/* A view that cannot write (a project file outside any task) gets no
            save control at all, rather than a permanently dead one. */}
        {!isReadOnly && editable && (
          <button
            type="button"
            onClick={onSave}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary hover:text-foreground"
          >
            <Save className="size-3" />
            save
          </button>
        )}
      </div>
      {lspMissing && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-warn/10 px-3 py-1.5 text-[11px]">
          <Wand2 className="size-3 shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-muted-foreground">
            {LSP_LABELS[lspMissing] ?? lspMissing} IntelliSense isn&apos;t installed
          </span>
          <button
            type="button"
            onClick={onInstallLsp}
            disabled={lspInstallBusy}
            className="flex shrink-0 items-center gap-1 rounded bg-foreground/90 px-2 py-0.5 font-medium text-background transition-colors hover:bg-foreground disabled:opacity-50"
          >
            {lspInstallBusy && <Loader2 className="size-3 animate-spin" />}
            {lspInstallBusy ? "Installing…" : "Install"}
          </button>
        </div>
      )}
    </>
  );
}
