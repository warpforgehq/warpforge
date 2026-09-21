import { FileDiff, FileMinus, FilePen, FilePlus, MousePointerClick, X } from "lucide-react";
import { memo } from "react";

import type { AttachmentDraft } from "../../lib/fileAttachments";
import type { FileDiff as FileDiffType } from "../../protocol";
import type { ComposerAttachment, ContextChip } from "../Composer";
import { DocumentAttachmentChip } from "./DocumentAttachmentChip";
import { ImageAttachmentPreview } from "./ImageAttachmentPreview";

const statusIcon = (s: FileDiffType["status"]) => {
  switch (s) {
    case "added":
      return <FilePlus className="size-3.5 text-ok" />;
    case "deleted":
      return <FileMinus className="size-3.5 text-destructive" />;
    case "renamed":
      return <FilePen className="size-3.5 text-warn" />;
    default:
      return <FileDiff className="size-3.5 text-info" />;
  }
};

interface AttachmentBarProps {
  diffs: ComposerAttachment[];
  attachments: AttachmentDraft[];
  contexts: ContextChip[];
  onRemoveDiff: (id: string) => void;
  onRemoveAttachment: (attachment: AttachmentDraft) => void;
  onRemoveContext: (id: string) => void;
}

export const AttachmentBar = memo(function AttachmentBar({
  diffs,
  attachments,
  contexts,
  onRemoveDiff,
  onRemoveAttachment,
  onRemoveContext,
}: AttachmentBarProps) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-input/50 px-2.5 py-2">
      {contexts.map((c) =>
        c.image ? (
          <div
            key={c.id}
            className="group relative w-44 overflow-hidden rounded-md border bg-secondary/60"
          >
            <img
              alt=""
              src={`data:image/png;base64,${c.image.base64}`}
              className="h-24 w-full border-b object-cover"
            />
            <div className="line-clamp-2 px-1.5 py-1 text-[11px] leading-snug" title={c.label}>
              {c.label}
            </div>
            <button
              type="button"
              aria-label={`Remove ${c.label}`}
              onClick={() => onRemoveContext(c.id)}
              className="absolute right-1 top-1 rounded bg-background/90 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <div
            key={c.id}
            className="group flex items-center gap-1.5 rounded-md border bg-secondary/60 py-1 pl-2 pr-1 text-xs"
          >
            <MousePointerClick className="size-3.5 shrink-0 text-info" />
            <span className="max-w-[220px] truncate">{c.label}</span>
            <button
              type="button"
              aria-label={`Remove ${c.label}`}
              className="rounded p-0.5 hover:bg-muted"
              onClick={() => onRemoveContext(c.id)}
            >
              <X className="size-3" />
            </button>
          </div>
        ),
      )}
      {diffs.map((a) => (
        <div
          key={a.id}
          className="group flex items-center gap-1.5 rounded-md border bg-secondary/60 px-2 py-1 font-mono text-xs"
        >
          {statusIcon(a.status)}
          <span className="max-w-[180px] truncate">{a.filePath}</span>
          <span>
            <span className="text-ok">+{a.addedLines}</span>{" "}
            <span className="text-destructive">-{a.removedLines}</span>
          </span>
          <button
            type="button"
            aria-label={`Remove ${a.filePath}`}
            onClick={() => onRemoveDiff(a.id)}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <ImageAttachmentPreview
            key={attachment.id}
            image={attachment}
            onRemove={() => onRemoveAttachment(attachment)}
          />
        ) : (
          <DocumentAttachmentChip
            key={attachment.id}
            document={attachment}
            onRemove={() => onRemoveAttachment(attachment)}
          />
        ),
      )}
    </div>
  );
});
