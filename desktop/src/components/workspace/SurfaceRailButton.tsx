import type { LucideIcon } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export interface SurfaceRailButtonProps {
  railKey: string;
  icon: LucideIcon;
  label: string;
  /** Live phrase from `surfaceSummary`, spoken after the label. */
  summary: string;
  shortcut: string;
  /** The travelling chip parks here: this is the pane that owns the split. */
  active: boolean;
  /** Selected, but its pane is folded away: a brighter icon, no fill of its
   *  own — only the chip may look like the active state. */
  ghost: boolean;
  onSelect: (fromKeyboard: boolean) => void;
  onFocus: (element: HTMLButtonElement) => void;
  tabIndex: number;
}

/**
 * One rail target. Its preview card lives inside the button and is revealed by
 * `group-hover` / `group-focus-visible`, so its anchor is the button's own box:
 * no shared card, no pointer bookkeeping, no timer to get out of step.
 */
export const SurfaceRailButton = forwardRef<HTMLButtonElement, SurfaceRailButtonProps>(
  function SurfaceRailButton(
    { railKey, icon: Icon, label, summary, shortcut, active, ghost, onSelect, onFocus, tabIndex },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        data-rail-item
        data-rail-key={railKey}
        data-rail-ghost={ghost ? "" : undefined}
        tabIndex={tabIndex}
        aria-label={`${label}, ${summary} · ${shortcut}`}
        aria-current={active ? "page" : undefined}
        // A keyboard activation reports no click count; it opens instantly
        // rather than travelling, because the trip is what makes it feel slow.
        onClick={(event) => onSelect(event.detail === 0)}
        onPointerDown={(event) => {
          event.currentTarget.dataset.pointerFocus = "true";
        }}
        onKeyDown={(event) => {
          delete event.currentTarget.dataset.pointerFocus;
        }}
        onFocus={(event) => onFocus(event.currentTarget)}
        className={cn(
          "group relative z-10 grid size-7 shrink-0 place-items-center rounded-md transition-[color,background-color,transform] duration-100 ease-[var(--ease-out)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring data-[pointer-focus=true]:focus-visible:ring-0",
          active
            ? "text-primary-foreground"
            : ghost
              ? "text-foreground/80"
              : "text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground",
        )}
      >
        <Icon aria-hidden className="size-4" />
        <span
          aria-hidden
          data-surface-peek=""
          className="pointer-events-none absolute right-full top-1/2 mr-2 w-56 -translate-y-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left text-popover-foreground opacity-0 shadow-md transition-opacity delay-150 duration-150 ease-[var(--ease-out)] group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
            <kbd className="tnum shrink-0 rounded border border-border px-1 font-sans text-[11px] text-muted-foreground/60">
              {shortcut}
            </kbd>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{summary}</span>
          <span className="mt-1 block text-[11px] text-muted-foreground/60">preview only</span>
        </span>
      </button>
    );
  },
);
