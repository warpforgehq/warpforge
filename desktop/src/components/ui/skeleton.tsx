import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The house skeleton pulse: one infinite ease-in-out opacity animation per
 * block, switched off under `prefers-reduced-motion`. Lifted verbatim from
 * `views/task-detail/FileDiffSkeleton.tsx`.
 */
export const SKELETON_PULSE =
  "animate-pulse [--animate-pulse:pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none";

/**
 * Height of a bar standing in for one line of text. A 20px code row and a 24px
 * prose row both leave it air, so a column of them reads as text rather than as
 * stacked blocks.
 */
export const SKELETON_LINE_BAR_PX = 8;

/**
 * Deterministic percent width. Never `Math.random()`, so screenshots and
 * snapshots are stable across renders.
 *
 * Narrow lanes pass their own band rather than clamping the default one:
 * `Math.min(40, skeletonWidth(i, 0))` collapses most rows onto the cap, which
 * is how a list of bars ends up looking machine-cut.
 *
 * @param seed Row, block or file index — what makes one lane differ from the next.
 * @param index Position within that row, so bars in one row are not all equal.
 * @param min Lower bound of the band, percent.
 * @param max Upper bound of the band, percent, exclusive.
 * @returns A width in percent, inside `[min, max)`.
 */
export function skeletonWidth(seed: number, index: number, min = 38, max = 82): number {
  return min + ((seed * 13 + index * 17) % (max - min));
}

/** The pulse owner. Emits `aria-busy`; never nest two of these. */
export function SkeletonBlock({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div aria-busy className={cn(SKELETON_PULSE, className)} {...props}>
      {children}
    </div>
  );
}

/**
 * One bar inside a `SkeletonBlock`. `w` is a percent and `h` is pixels; fixed
 * lanes pass Tailwind sizes through `className` instead. `tone` matches the
 * diff skeleton's two fills.
 */
export function SkeletonBar({
  w,
  h,
  tone = "muted",
  className,
  ...props
}: React.ComponentProps<"span"> & {
  w?: number;
  h?: number;
  tone?: "primary" | "muted";
}) {
  return (
    <span
      className={cn(
        "block rounded-sm",
        tone === "primary" ? "bg-muted-foreground/15" : "bg-muted-foreground/10",
        className,
      )}
      style={{ width: w === undefined ? undefined : `${w}%`, height: h }}
      {...props}
    />
  );
}
