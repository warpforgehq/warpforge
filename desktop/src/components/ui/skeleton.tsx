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
 * Deterministic 38–82 percent width. Never `Math.random()`, so screenshots and
 * snapshots are stable across renders.
 */
export function skeletonWidth(seed: number, index: number): number {
  return 38 + ((seed * 13 + index * 17) % 44);
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
