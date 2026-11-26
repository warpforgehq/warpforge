import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DeleteTaskDialog } from "@/components/DeleteTaskDialog";
import { daemon } from "@/daemon";
import { taskLabel } from "@/lib/taskLabel";
import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

export function useTaskActions(task: TaskInfo, onComplete?: () => void) {
  const [pending, setPending] = useState<"deleteTask" | "archiveTask" | null>(null);
  const [busy, setBusy] = useState(false);

  const complete = () => {
    setPending(null);
    onComplete?.();
  };
  const archive = async () => {
    await daemon.archiveTask(task.id);
    complete();
  };
  const request = (action: "deleteTask" | "archiveTask") => {
    if (busy) return;
    if (useUi.getState().confirmations[action]) {
      setPending(action);
      return;
    }
    setBusy(true);
    const run =
      action === "archiveTask" ? archive : () => daemon.deleteTask(task.id, false).then(complete);
    void run()
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setBusy(false));
  };

  return {
    busy,
    archiveTask: () => request("archiveTask"),
    deleteTask: () => request("deleteTask"),
    dialogs: (
      <>
        <DeleteTaskDialog
          task={task}
          label={taskLabel(task)}
          open={pending === "deleteTask"}
          onCancel={() => setPending(null)}
          onDeleted={complete}
        />
        <ConfirmDialog
          open={pending === "archiveTask"}
          title="Archive this task?"
          description={<>Move “{taskLabel(task)}” to archived tasks.</>}
          confirmLabel="Archive task"
          busyLabel="Archiving…"
          destructive={false}
          onCancel={() => setPending(null)}
          onConfirm={archive}
        />
      </>
    ),
  };
}
