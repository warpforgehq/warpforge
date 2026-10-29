import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { daemon } from "@/daemon";
import { isChat } from "@/lib/taskKind";
import type { TaskInfo } from "@/protocol";

/**
 * Confirms deleting a task. For a chat whose folder holds files it also asks
 * whether they go too, yes by default; an empty folder goes without asking.
 * @param props.task The task to delete.
 * @param props.label Its name as the question shows it.
 * @param props.open Whether the dialog is shown.
 * @param props.onCancel Closes it without deleting.
 * @param props.onDeleted Called once the task is gone.
 * @returns The dialog.
 */
export function DeleteTaskDialog({
  task,
  label,
  open,
  onCancel,
  onDeleted,
}: {
  task: TaskInfo;
  label: string;
  open: boolean;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const chat = isChat(task);
  const [fileCount, setFileCount] = useState(0);
  const [deleteFolder, setDeleteFolder] = useState(true);
  useEffect(() => {
    if (!open || !chat) return;
    let current = true;
    setDeleteFolder(true);
    setFileCount(0);
    daemon
      .chatFolder(task.id)
      .then((folder) => current && setFileCount(folder.fileCount))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [chat, open, task.id]);

  return (
    <ConfirmDialog
      open={open}
      title={chat ? "Delete this chat?" : "Delete this task?"}
      description={<>“{label}” and its conversation will be gone. This cannot be undone.</>}
      confirmLabel={chat ? "Delete chat" : "Delete task"}
      busyLabel="Deleting…"
      onCancel={onCancel}
      onConfirm={async () => {
        await daemon.deleteTask(task.id, chat && fileCount > 0 && deleteFolder);
        onDeleted();
      }}
    >
      {fileCount > 0 && (
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={deleteFolder}
            onChange={(event) => setDeleteFolder(event.target.checked)}
            className="size-3.5 accent-[hsl(var(--primary))]"
          />
          Also delete chat folder ({fileCount} {fileCount === 1 ? "file" : "files"})
        </label>
      )}
    </ConfirmDialog>
  );
}
