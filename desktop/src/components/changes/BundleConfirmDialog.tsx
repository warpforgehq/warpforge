import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface BundleConfirmRequest {
  title: string;
  description: string;
  /** Repo-relative paths the action touches. */
  files: string[];
  confirmLabel: string;
}

/**
 * Last-chance confirm before a shelf/stash entry is destroyed: "Apply & Drop"
 * applies the files into the working tree and deletes the entry, "Drop"
 * deletes it outright. Shows exactly which files are involved — a misclick
 * here is otherwise silent and unrecoverable. Deliberately minimal: no name,
 * comment, or context-tracking controls.
 */
export function BundleConfirmDialog({
  request,
  busy,
  onClose,
  onConfirm,
}: {
  /** Null hides the dialog. */
  request: BundleConfirmRequest | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!request) {
    return null;
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-label={request.title}>
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>{request.description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-48 overflow-auto rounded bg-deep-surface p-2 font-mono text-[11px] leading-5">
          {request.files.map((path) => (
            <p key={path} className="truncate text-muted-foreground" title={path}>
              {path}
            </p>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : request.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
