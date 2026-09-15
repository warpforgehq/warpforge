import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface PaneHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  /** Content before the title — a collapse toggle, search field or tab strip. */
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * Render the title in the code face at the mono size. For headers whose
   * identity is a path rather than a name (file diffs, the editor toolbar).
   */
  mono?: boolean;
}

/**
 * The one pane header. 36px tall, a 12px gutter, a `title` label and a `rule`
 * underline — no background shift, because a header is chrome, not content.
 * Actions sit on the right; `leading` carries anything that belongs before the
 * title (a collapse chevron, a tab strip).
 */
export const PaneHeader = React.forwardRef<HTMLElement, PaneHeaderProps>(
  ({ actions, className, icon: Icon, leading, mono, subtitle, title, ...props }, ref) => (
    <header
      ref={ref}
      data-pane-header=""
      className={cn("flex h-9 shrink-0 items-center gap-2 border-b border-border px-3", className)}
      {...props}
    >
      {leading}
      {title != null && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {Icon && <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
          <h2
            className={cn(
              "min-w-0 truncate text-foreground",
              mono
                ? "font-mono text-[13px] font-medium"
                : "text-[15px] font-semibold tracking-[-0.01em]",
            )}
          >
            {title}
          </h2>
          {subtitle != null && (
            <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>
          )}
        </div>
      )}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  ),
);
PaneHeader.displayName = "PaneHeader";
