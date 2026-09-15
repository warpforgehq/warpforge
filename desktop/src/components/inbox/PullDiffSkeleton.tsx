import type { PullRequestFile } from "@/protocol";
import { FileDiffSkeleton } from "@/views/task-detail/FileDiffSkeleton";

import { ROW_HEIGHT_PX } from "./PullDiffHunk";

/**
 * The diff body before its first patch arrives. Three `FileDiffSkeleton`
 * blocks — the same file shape the task diff surface draws — using
 * `PullDiffFile`'s 20px row and 36px header so the real files land in the
 * space the skeleton reserved. Only a cold load reaches this; a commit picked
 * over already-loaded content dims in place instead (`PullDiffView`).
 */

const FILE_COUNT = 3;
const HEADER_PX = 36;
const MIN_LINES = 6;
/** `FileDiffSkeleton`'s own row cap: past this it draws a fading tail instead
 *  of rows, so asking for more here buys nodes and no shape. */
const MAX_LINES = 24;

export function PullDiffSkeleton({
  files,
  mode,
}: {
  /** The file list when the wire carried one; the line count is a proxy. */
  files?: readonly PullRequestFile[] | null;
  mode: "unified" | "split";
}) {
  return (
    <div
      role="status"
      aria-label="Loading changes"
      data-testid="pull-diff-skeleton"
      className="flex min-h-0 flex-1 flex-col gap-3 p-3"
    >
      {Array.from({ length: FILE_COUNT }, (_, index) => {
        const file = files?.[index];
        const lineCount = file ? file.additions + file.deletions : MIN_LINES;
        const rows = mode === "split" ? Math.ceil(lineCount / 2) : lineCount;
        const lines = Math.min(MAX_LINES, Math.max(MIN_LINES, rows));
        return (
          <FileDiffSkeleton key={index} index={index} height={HEADER_PX + lines * ROW_HEIGHT_PX} />
        );
      })}
    </div>
  );
}
