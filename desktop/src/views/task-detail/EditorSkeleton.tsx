import { useEffect, useRef, useState } from "react";

import {
  SkeletonBar,
  SkeletonBlock,
  SKELETON_LINE_BAR_PX,
  skeletonWidth,
} from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ROW_HEIGHT_PX } from "../../components/inbox/PullDiffHunk";

/**
 * Placeholder for an editor or diff body whose module or document has not
 * arrived: a 40px gutter of right-aligned line numbers beside a code column,
 * on the diff's measured 20px row. The indent cycles a fixed pattern so the
 * block reads as code, and the line count comes from the slot the real
 * content will fill, so the swap is a fill rather than a layout change.
 */

const INDENT_STEPS = [0, 0, 2, 4, 4, 2, 0, 2, 4, 0] as const;
const FALLBACK_LINES = 12;

export function EditorSkeleton({
  height,
  maxLines = Number.POSITIVE_INFINITY,
  className,
  "aria-label": ariaLabel = "Loading editor",
}: {
  /** Exact slot height, when a virtualizer estimate already reserved one. */
  height?: number;
  /** Cap for preview call sites; a full editor fills whatever it is given. */
  maxLines?: number;
  className?: string;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [measuredLines, setMeasuredLines] = useState(FALLBACK_LINES);

  useEffect(() => {
    if (height !== undefined) return;
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const lines = Math.floor(node.clientHeight / ROW_HEIGHT_PX);
      if (lines > 0) setMeasuredLines(lines);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [height]);

  const wanted =
    height === undefined ? measuredLines : Math.max(1, Math.floor(height / ROW_HEIGHT_PX));
  const lines = Math.min(maxLines, wanted);
  // A capped block stops at its last line instead of stretching: the preview
  // panes are taller than eight lines, and the leftover read as dead space
  // inside the skeleton rather than as room the file has not filled.
  const capped = lines < wanted;

  return (
    <div
      ref={ref}
      className={cn(capped ? "min-h-0" : "h-full min-h-0", className)}
      style={height === undefined ? undefined : { height }}
    >
      <SkeletonBlock
        aria-label={ariaLabel}
        data-testid="editor-skeleton"
        className={cn(
          "flex min-h-0 flex-col overflow-hidden font-mono",
          capped ? "h-fit" : "h-full",
        )}
      >
        {Array.from({ length: lines }, (_, line) => {
          const indent = INDENT_STEPS[line % INDENT_STEPS.length];
          return (
            <div
              key={line}
              className="flex shrink-0 items-center gap-3 px-3"
              style={{ height: ROW_HEIGHT_PX }}
            >
              <span className="flex w-10 shrink-0 justify-end">
                <SkeletonBar h={SKELETON_LINE_BAR_PX} className="w-3" />
              </span>
              <span
                className="flex h-full min-w-0 flex-1 items-center"
                style={{ paddingLeft: indent * 8 }}
              >
                <SkeletonBar h={SKELETON_LINE_BAR_PX} w={skeletonWidth(line, indent)} />
              </span>
            </div>
          );
        })}
      </SkeletonBlock>
    </div>
  );
}
