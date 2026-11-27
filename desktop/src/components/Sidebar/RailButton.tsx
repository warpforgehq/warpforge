import type { LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A corner badge: a count pill, or a bare attention light when the number is noise. */
export type RailBadge = { kind: "count"; value: number; hot: boolean } | { kind: "light" };

/**
 * One 36px rail target. Selected is a 2px `primary` bar on the rail's outer
 * edge plus a faint fill; only one button in the rail is ever selected.
 */
export const RailButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    /** Tooltip text when it says more than the label. */
    tooltip?: string;
    active?: boolean;
    badge?: RailBadge | null;
    shortcut?: string;
    icon?: LucideIcon;
    children?: ReactNode;
    className?: string;
    onClick: () => void;
    onFocus?: () => void;
    tabIndex?: number;
    ariaExpanded?: boolean;
    ariaControls?: string;
  } & Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onContextMenu" | "draggable" | "onDragStart" | "onDragOver" | "onDrop"
  >
>(function RailButton(
  {
    label,
    tooltip,
    active,
    badge,
    shortcut,
    icon: Icon,
    children,
    className,
    onClick,
    onFocus,
    tabIndex,
    ariaExpanded,
    ariaControls,
    ...dom
  },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          {...dom}
          ref={ref}
          type="button"
          data-rail-item
          data-active={active || undefined}
          tabIndex={tabIndex}
          onFocus={onFocus}
          onClick={onClick}
          aria-label={label}
          aria-expanded={ariaExpanded}
          aria-controls={ariaControls}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative grid size-9 place-items-center rounded-md transition-[color,background-color,transform] duration-100 ease-[var(--ease-out)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            active
              ? "bg-accent/60 text-foreground"
              : "text-muted-foreground/80 hover:bg-accent/40 hover:text-foreground",
            className,
          )}
        >
          {active && (
            <span
              aria-hidden
              data-rail-indicator
              className="absolute -left-2.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary"
            />
          )}
          {children ?? (Icon ? <Icon className="size-[18px]" strokeWidth={1.75} /> : null)}
          <Badge badge={badge} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        className="flex items-center gap-3 [&_kbd]:text-muted-foreground/70"
      >
        <span>{tooltip ?? label}</span>
        {badge?.kind === "count" && badge.value > 0 && (
          <span className="font-mono text-[0.6875rem] tabular-nums text-warn">{badge.value}</span>
        )}
        {shortcut && (
          <kbd className="rounded border border-border px-1 font-mono text-[0.625rem]">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
});

function Badge({ badge }: { badge?: RailBadge | null }) {
  if (!badge) return null;
  if (badge.kind === "light") {
    return (
      <span
        aria-hidden
        data-rail-badge="light"
        className="absolute right-1 top-1 size-[7px] rounded-full bg-warn shadow-[0_0_6px_hsl(var(--warn)/0.7)] ring-2 ring-chrome"
      />
    );
  }
  if (badge.value <= 0) return null;
  return (
    <span
      aria-hidden
      data-rail-badge="count"
      className={cn(
        "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[0.625rem] font-semibold leading-none tabular-nums ring-2 ring-chrome",
        badge.hot ? "bg-foreground/80 text-background" : "bg-secondary text-secondary-foreground",
      )}
    >
      {badge.value > 99 ? "99+" : badge.value}
    </span>
  );
}
