import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  /**
   * Required wherever the user can actually change the emptiness — an empty
   * list that could hold a first item must offer the way to add one. Omit it
   * only for a genuinely passive state (nothing to do but wait).
   */
  action?: React.ReactNode;
  /** Drop the vertical padding when the state sits inside a short container. */
  compact?: boolean;
}

/**
 * The one empty state. Icon, a `title` in the title type, an optional `hint`
 * in body type, and an optional action. Everything a "there is nothing here"
 * surface needs to say, in one place, so the copy is written once and the
 * composition stops being re-decided per surface.
 */
export function EmptyState({
  action,
  className,
  compact,
  hint,
  icon: Icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 text-center",
        compact ? "py-6" : "py-10",
        className,
      )}
      {...props}
    >
      {Icon && (
        <div
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-secondary/40 text-muted-foreground"
        >
          <Icon className="size-5" />
        </div>
      )}
      <div className="max-w-sm">
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</p>
        {hint && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
