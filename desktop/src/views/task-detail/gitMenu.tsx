import type { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { GitOpResult } from "../../protocol";

/** Surface a git operation's outcome, including any conflicts it listed. */
export function handleGitOpResult(r: GitOpResult) {
  switch (r.status) {
    case "up_to_date":
      toast.info(r.message);
      break;
    case "ok":
      toast.success(r.message);
      break;
    case "conflict":
      toast.error(r.message, {
        description: r.conflicts.length > 0 ? r.conflicts.join(", ") : undefined,
      });
      break;
    case "error":
      toast.error(r.message);
      break;
  }
}

export const handleGitOpError = (e: Error) => toast.error(e.message);

/** Refresh everything a branch or worktree change can affect for one task. */
export function invalidateAll(queryClient: ReturnType<typeof useQueryClient>, taskId: string) {
  void queryClient.invalidateQueries({ queryKey: ["diff", taskId] });
  void queryClient.invalidateQueries({ queryKey: ["fileList", taskId] });
  void queryClient.invalidateQueries({ queryKey: ["branches", taskId] });
}

/** One row of the git actions block above the branch tree. */
export function GitMenuAction({
  disabled,
  icon,
  label,
  onClick,
  shortcut,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  shortcut: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-accent/50 disabled:opacity-50"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      <kbd className="font-sans text-[10px] text-muted-foreground">{shortcut}</kbd>
    </button>
  );
}
