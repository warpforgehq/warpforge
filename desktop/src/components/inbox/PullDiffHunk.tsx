import * as React from "react";

import { canObserveViewport, observeNearViewport } from "@/lib/nearViewport";

import { PullDiffLines, type PullDiffLinesProps } from "./PullDiffLines";

/** The diff's `leading-5` — what one rendered row is worth in an estimate. */
export const ROW_HEIGHT_PX = 20;

/**
 * One hunk, mounted only while it is near the viewport.
 *
 * A syntax-coloured diff row costs ~27 DOM elements, so a 10k-line pull
 * request builds a quarter of a million nodes if every row is mounted at once.
 * `content-visibility` skips painting them but not creating them, which is why
 * off-screen hunks stand in here as a spacer instead.
 */
export function PullDiffHunk({
  pinned,
  ...props
}: PullDiffLinesProps & {
  /** Keeps this hunk mounted wherever it scrolls to. */
  pinned?: boolean;
}) {
  const { hunk, mode } = props;
  const rows = mode === "split" ? Math.ceil(hunk.lines.length / 2) : hunk.lines.length;
  const spacer = React.useRef<HTMLDivElement | null>(null);
  // Nothing to ask when there is no observer, so the rows render outright: a
  // diff must never be blank because a spacer never resolved.
  const [near, setNear] = React.useState(!canObserveViewport());
  const height = React.useRef(rows * ROW_HEIGHT_PX);

  // The split view halves the row count, so a mode change invalidates whatever
  // the spacer last measured.
  React.useEffect(() => {
    height.current = rows * ROW_HEIGHT_PX;
  }, [rows]);

  React.useEffect(() => {
    const node = spacer.current;
    if (!node) return;
    return observeNearViewport(node, (visible) => {
      // Measured on the way out: a spacer of the *estimated* height would move
      // every row below it, and the scroll position with them.
      if (!visible) {
        const measured = node.getBoundingClientRect().height;
        if (measured > 0) height.current = measured;
      }
      setNear(visible);
    });
  }, []);

  const mounted = near || pinned;
  return (
    <div ref={spacer} style={mounted ? undefined : { height: height.current }}>
      {mounted ? <PullDiffLines {...props} /> : null}
    </div>
  );
}
