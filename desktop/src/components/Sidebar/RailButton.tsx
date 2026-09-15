import type { LayoutGrid } from "lucide-react";
import { forwardRef, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One 32px rail target. Active is a 2px × 20px `primary` edge-bar, not a fill —
 * the same "where you are" language as the workspace tab underline — and the
 * icon stays monochrome otherwise. Press and focus are the house tokens.
 */
export const RailButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    active?: boolean;
    count?: number;
    hot?: boolean;
    shortcut?: string;
    icon?: typeof LayoutGrid;
    children?: ReactNode;
    onClick: () => void;
    onFocus?: () => void;
    tabIndex?: number;
    ariaExpanded?: boolean;
  }
>(function RailButton(
  {
    label,
    active,
    count,
    hot,
    shortcut,
    icon: Icon,
    children,
    onClick,
    onFocus,
    tabIndex,
    ariaExpanded,
  },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          data-rail-item
          tabIndex={tabIndex}
          onFocus={onFocus}
          onClick={onClick}
          aria-label={label}
          aria-expanded={ariaExpanded}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative grid size-8 place-items-center rounded-md transition-[color,background-color,transform] duration-100 ease-[var(--ease-out)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            active
              ? "text-foreground"
              : "text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground",
          )}
        >
          {active && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
            />
          )}
          {children ?? (Icon ? <Icon className="size-4" /> : null)}
          {count !== undefined && count > 0 && (
            <span
              aria-hidden
              className={cn(
                "tnum absolute bottom-0 right-0.5 text-[11px] leading-none",
                hot ? "text-warn" : "text-muted-foreground/60",
              )}
            >
              {count}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        className="flex items-center gap-3 [&_kbd]:text-muted-foreground/60"
      >
        <span>{label}</span>
        {shortcut && (
          <kbd className="tnum rounded border border-border px-1 font-sans text-[11px]">
            {shortcut}
          </kbd>
        )}
        {count !== undefined && count > 0 && <span className="tnum text-warn">{count}</span>}
      </TooltipContent>
    </Tooltip>
  );
});
