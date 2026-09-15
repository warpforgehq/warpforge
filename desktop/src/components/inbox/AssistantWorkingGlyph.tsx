import { cn } from "@/lib/utils";

/**
 * The house "an agent is working on this" mark: one 90° arc on a ring, not a
 * dashed circle — at 14px the dashes slide more than their own width between
 * frames and read as a marquee (spec 08 §C.6). `linear` is correct here: a
 * constant-angular-velocity indicator is not an enter.
 */
export function AssistantWorkingGlyph({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Assistant review in progress"
      viewBox="0 0 24 24"
      fill="none"
      className={cn(
        "animate-spin text-ok [--animate-spin:spin_1.4s_linear_infinite] motion-reduce:animate-none",
        className,
      )}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="25 75"
        pathLength={100}
      />
    </svg>
  );
}
