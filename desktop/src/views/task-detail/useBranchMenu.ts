import { toast } from "sonner";

import { copyText } from "../../lib/clipboard";
import type { BranchWorktree } from "../../protocol";
import { useUi } from "../../store/ui";
import type { BranchAction } from "./BranchActionsDialog";
import { heldMessage, planCheckout } from "./branchCheckout";

/**
 * Route a branch-row menu action to its dialog, op or navigation. A branch
 * held by another worktree never reaches `git checkout`: it opens the owning
 * task, or explains where the branch is checked out.
 *
 * @param opts.branch The checkout's current branch.
 * @param opts.holders Branch → worktree holding it.
 * @param opts.close Closes the branch popover.
 * @param opts.openActionDialog Closes the popover and opens a branch dialog.
 * @param opts.switchTo Switches this checkout to a local branch.
 * @param opts.update Syncs the current branch with its remote.
 * @param opts.openPush Opens the push dialog.
 * @param opts.openMerge Opens the worktree merge dialog.
 * @returns Handler taking the action id and the row's branch.
 */
export function useBranchMenu(opts: {
  branch: string | null;
  holders: Map<string, BranchWorktree>;
  close: () => void;
  openActionDialog: (a: BranchAction) => void;
  switchTo: (target: string) => void;
  update: () => void;
  openPush: () => void;
  openMerge: () => void;
}): (actionId: string, item: string) => void {
  const { branch, holders, close, openActionDialog, switchTo } = opts;

  const checkout = (target: string, onFree: () => void) => {
    const plan = planCheckout(target, holders);
    if (plan.kind === "checkout") {
      onFree();
      return;
    }
    close();
    if (plan.kind === "open-task") {
      useUi.getState().openTask(plan.taskId);
      return;
    }
    toast.error(heldMessage(target, plan), {
      action: { label: "Copy path", onClick: () => void copyText(plan.path, "Path") },
    });
  };

  return (actionId, item) => {
    switch (actionId) {
      case "new-branch":
        if (branch) openActionDialog({ kind: "create", from: branch });
        return;
      case "checkout":
        checkout(item, () => switchTo(item));
        return;
      case "checkout-as-remote": {
        const localName = item.split("/").slice(1).join("/") || "new-branch";
        openActionDialog({ kind: "create", from: item, defaultName: localName });
        return;
      }
      case "create":
        openActionDialog({ kind: "create", from: item });
        return;
      case "checkout-update":
        checkout(item, () => openActionDialog({ kind: "checkout-update", branch: item }));
        return;
      case "rebase":
        openActionDialog({ kind: "rebase", branch: item });
        return;
      case "rebase-remote":
      case "pull-rebase":
        if (branch) openActionDialog({ kind: "rebase", branch, target: item });
        return;
      case "rebase-main":
        openActionDialog({ kind: "rebase", branch: item, target: "main" });
        return;
      case "merge":
        openActionDialog({ kind: "merge" });
        return;
      case "merge-main":
        openActionDialog({ kind: "merge", target: "main" });
        return;
      case "merge-remote":
      case "pull-merge":
        openActionDialog({ kind: "merge", target: item });
        return;
      case "update":
        opts.update();
        return;
      case "push":
        close();
        opts.openPush();
        return;
      case "merge-worktree":
        close();
        opts.openMerge();
        return;
      case "rename":
        openActionDialog({ kind: "rename", branch: item });
        return;
      case "delete":
        openActionDialog({ kind: "delete", branch: item });
        return;
    }
  };
}
