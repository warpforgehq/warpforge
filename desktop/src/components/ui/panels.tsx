import { Group, Panel as MotionPanel, Separator, type AnyPanelProps } from "motion-panels/react";
import type { Transition } from "motion/react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Warpforge's chrome around motion-panels. The library ships the resize engine
 * and the separator behaviour unstyled; the skin — a seam that only appears
 * while it is being aimed at — lives here so every split matches.
 */
export const PanelGroup = Group;

const FOLD: Transition = { duration: 0.18, ease: [0.32, 0.72, 0, 1] };

/**
 * The library's panel element is a plain block box. Every pane in this app is
 * written as a flex item (`flex-1 min-h-0`), which in a block box falls back to
 * its content height and escapes the split, so the box is a column here.
 *
 * A folding panel holds its content at the old width and clips it, so the pane
 * reads as a shutter rather than something sliding out. Panels that drop their
 * content on fold fade it as the shutter closes, which softens that.
 */
export function Panel({ className, ...props }: AnyPanelProps) {
  const unmounts = "keepMounted" in props && props.keepMounted === false;
  return (
    <MotionPanel
      transition={FOLD}
      {...(unmounts ? { exit: { opacity: 0 }, initial: false } : null)}
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    />
  );
}

/**
 * Sits over the pane a drag is about to fold away. The caller renders it only
 * while releasing would actually fold, so the promise it makes always holds.
 *
 * @param label What the pane holds, named as the sentence reads it.
 */
export function PanelCollapseHint({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/25 backdrop-blur-[2px]">
      <span className="px-4 text-center text-lg font-semibold text-black dark:text-white">
        Release to hide the {label}
      </span>
    </div>
  );
}

/**
 * @param divider Whether the seam draws the rule the rail it replaced used to
 *   carry. Off for splits whose panes already have their own frame, where a
 *   rule between two borders reads as a gap.
 */
export function PanelSeparator({
  className,
  divider = true,
  onPointerDown,
  "aria-label": ariaLabel = "Resize panel",
  ...props
}: ComponentProps<typeof Separator> & { divider?: boolean }) {
  return (
    <Separator
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        // The library suppresses selection only once the drag clears its 3px
        // pan threshold, by which point the browser has started one and goes
        // on extending it. Focus by hand since this drops the native press.
        event.preventDefault();
        event.currentTarget.focus();
        onPointerDown?.(event);
      }}
      className={cn(
        "group/sep relative z-10 shrink-0 select-none focus-visible:outline-none",
        divider ? "bg-border/70" : "bg-transparent",
        // `after` is the grab area: 8px wide, so the 1px seam is still easy to hit.
        "after:absolute after:bg-transparent",
        // `before` is the accent on top of that rule: a soft blurred band rather
        // than a hard colour swap.
        "before:pointer-events-none before:absolute before:opacity-0 before:blur-[1px] before:transition-opacity before:duration-200",
        "hover:before:opacity-100 focus-visible:before:opacity-100 data-[resizing]:before:opacity-100 data-[crossing]:before:opacity-100",
        // Horizontal group → vertical separator.
        "aria-[orientation=vertical]:w-px aria-[orientation=vertical]:cursor-col-resize",
        "aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-2 aria-[orientation=vertical]:after:-translate-x-1/2",
        "aria-[orientation=vertical]:before:inset-y-0 aria-[orientation=vertical]:before:-inset-x-px",
        "aria-[orientation=vertical]:before:bg-[linear-gradient(to_right,transparent,hsl(var(--primary)/1),transparent)]",
        // Vertical group → horizontal separator.
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:-inset-y-px",
        "aria-[orientation=horizontal]:before:bg-[linear-gradient(to_bottom,transparent,hsl(var(--primary)/0.4),transparent)]",
        className,
      )}
      {...props}
    />
  );
}
