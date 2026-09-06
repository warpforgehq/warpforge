import { toast } from "sonner";

/**
 * Git failures arrive with whatever the command printed attached, and a hook
 * that ran first can bury the reason under its own log. Git states why it gave
 * up on the last line, so lead with that and keep the log a click away.
 */
export function reportGitFailure(title: string, cause: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const lines = detail.split("\n").filter((line) => line.trim().length > 0);
  const last = lines[lines.length - 1]?.trim() ?? detail;
  const reason = last.length > 200 ? `${last.slice(0, 200)}…` : last;
  toast.error(title, {
    description: reason,
    duration: 10_000,
    action:
      reason === detail
        ? undefined
        : {
            label: "Copy",
            onClick: () => void navigator.clipboard.writeText(detail),
          },
  });
}
