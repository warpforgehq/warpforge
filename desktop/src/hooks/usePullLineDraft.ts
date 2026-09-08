import * as React from "react";

import { lineNumberFor, lineSide, type CommentIntent } from "@/components/inbox/PullDiffLines";
import type { PatchLine } from "@/lib/pullDiff";

/**
 * The comment being written on a diff, and what it covers.
 *
 * Identified by side as well as line: the same number exists on both sides of
 * a hunk, and matching on the number alone opened two composers for one
 * click. `anchor` is where the range started, so shift-clicking above the
 * first line grows the span upwards instead of inverting it.
 */
export interface PullLineDraft {
  path: string;
  side: "LEFT" | "RIGHT";
  anchor: number;
  start: number;
  end: number;
  /** True while the button is still down: the lines are still being chosen,
   *  and the composer has not been asked for yet. */
  pending: boolean;
}

/**
 * Selecting the lines a comment covers.
 *
 * Pressing a gutter starts a span and a drag; pulling down the column grows
 * it, which is the gesture GitHub taught everyone. Shift-clicking a second
 * line does the same thing without the drag, for anyone who reaches a far
 * line by scrolling. A `hover` only counts while the button is still held —
 * the gutter cannot know that, so it reports every pass and this decides.
 */
export function usePullLineDraft() {
  const [draft, setDraft] = React.useState<PullLineDraft | null>(null);
  const dragging = React.useRef(false);

  const commit = React.useCallback(() => {
    dragging.current = false;
    setDraft((current) => (current?.pending ? { ...current, pending: false } : current));
  }, []);

  const onComment = React.useCallback(
    (path: string, line: PatchLine, intent: CommentIntent) => {
      if (intent === "commit") {
        commit();
        return;
      }
      const number = lineNumberFor(line);
      if (number === undefined) return;
      if (intent === "hover" && !dragging.current) return;
      const side = lineSide(line);
      if (intent === "start") dragging.current = true;
      setDraft((current) => {
        const grow = intent !== "start" && current?.path === path && current.side === side;
        if (grow && current) {
          return {
            ...current,
            end: Math.max(current.anchor, number),
            pending: intent === "hover" && current.pending,
            start: Math.min(current.anchor, number),
          };
        }
        return {
          anchor: number,
          end: number,
          path,
          // A fresh press waits for its release; shift-click has none to wait for.
          pending: intent === "start",
          side,
          start: number,
        };
      });
    },
    [commit],
  );

  // The button can be released anywhere, including off the diff entirely, and
  // that release is what opens the composer.
  React.useEffect(() => {
    window.addEventListener("pointerup", commit);
    window.addEventListener("pointercancel", commit);
    return () => {
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", commit);
    };
  }, [commit]);

  return { draft, onComment, setDraft };
}
