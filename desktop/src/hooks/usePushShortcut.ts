import { useEffect } from "react";
import { toast } from "sonner";

import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";
import { openBranchCommits } from "@/views/push/branchNavigation";

export function usePushShortcut(tasks: TaskInfo[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "k") {
        return;
      }
      e.preventDefault();
      const id = useUi.getState().openTaskId;
      if (!id || !tasks.some((task) => task.id === id)) {
        toast.info("Open a task before pushing its branch");
        return;
      }
      openBranchCommits();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tasks]);
}
