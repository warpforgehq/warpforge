import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { daemon } from "../../daemon";

export type FileSystemAction =
  | { kind: "create-file" | "create-folder"; parent: string }
  | { kind: "rename" | "delete"; path: string };

export function FileSystemActionDialog({
  action,
  taskId,
  project,
  onComplete,
  onClose,
}: {
  action: FileSystemAction | null;
  taskId: string;
  /** Subject when no task owns the tree — the project page's Files surface. */
  project?: string;
  onComplete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!action) return null;

  const isDelete = action.kind === "delete";
  const basePath = "path" in action ? action.path : action.parent;
  const title = isDelete
    ? "Delete"
    : action.kind === "rename"
      ? "Rename"
      : action.kind === "create-folder"
        ? "New Folder"
        : "New File";
  const label = isDelete ? basePath : action.kind === "rename" ? basePath : "Enter a name.";

  const submit = async () => {
    if (!isDelete && !name.trim()) return;
    setBusy(true);
    try {
      const trimmed = name.trim();
      const parent =
        isDelete || action.kind === "rename"
          ? basePath.split("/").slice(0, -1).join("/")
          : basePath;
      const nextPath = isDelete ? basePath : `${parent ? `${parent}/` : ""}${trimmed}`;
      const method = isDelete
        ? "file.delete"
        : action.kind === "rename"
          ? "file.rename"
          : "file.create";
      const subject = taskId ? { task_id: taskId } : { project };
      const params = isDelete
        ? { ...subject, path: basePath }
        : action.kind === "rename"
          ? { ...subject, path: basePath, new_path: nextPath }
          : { ...subject, path: nextPath, directory: action.kind === "create-folder" };
      await daemon.request(method, params);
      toast.success(`${title} complete`);
      onComplete();
      setName("");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isDelete ? `Delete ${label}? This cannot be undone.` : label}
          </DialogDescription>
        </DialogHeader>
        {!isDelete && (
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            placeholder="name"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isDelete ? "destructive" : "default"}
            disabled={busy || (!isDelete && !name.trim())}
            onClick={() => void submit()}
          >
            {busy ? "Working…" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
