import type { FileDiff } from "../../protocol";

/**
 * A file's rendered height, from its own hunk spans — the rows the editor
 * actually lays out. The merge/unified views run `collapseUnchanged`, so an
 * unchanged run between changes folds to a few context lines; the rendered
 * height tracks the changed hunks, not the file's length.
 *
 * The estimate this replaces used the last hunk's reach into the new file
 * (`newStart + newLines`). For a change near the end of a large file that is
 * thousands of times the rendered height: the skeleton reserved a huge empty
 * band, and once the editor measured itself the virtualizer kept rewriting
 * every position below it while scrolling. Counting the hunks keeps the
 * estimate within a small factor of the measurement, so a measurement
 * confirms instead of corrects.
 */
export function estimateFileHeight(file: FileDiff | undefined): number {
  const HEADER_PX = 36;
  const LINE_PX = 20;
  /** Lines of context `collapseUnchanged` keeps around each change. */
  const HUNK_MARGIN_LINES = 5;
  const MIN_LINES = 8;
  if (!file) return 384;
  let lines = 0;
  for (const hunk of file.hunks) {
    lines += Math.max(hunk.oldLines, hunk.newLines);
  }
  lines += HUNK_MARGIN_LINES * file.hunks.length + 6;
  return HEADER_PX + Math.max(lines, MIN_LINES) * LINE_PX;
}

/**
 * Height for one virtualized diff row. The row is a header plus a diff body,
 * and the body's CodeMirror editor is created asynchronously (its language
 * module loads first), so for a frame or more the row's real height is just
 * the header — ~36px, against an estimate in the hundreds. Measuring that
 * would cache a tiny height and slide every row below it up into an overlap.
 * Until a `.cm-editor` is in the body, answer with the estimate the skeleton
 * used so the row holds its slot. A skeleton or an error row has no diff body
 * at all, and measures normally.
 */
export function measureDiffRow(
  element: Pick<HTMLElement, "getAttribute" | "offsetHeight" | "querySelector">,
  files: readonly FileDiff[],
): number {
  const body = element.querySelector(".warpforge-merge-diff, .warpforge-unified-diff");
  if (body && !body.querySelector(".cm-editor")) {
    const index = Number(element.getAttribute("data-index"));
    return estimateFileHeight(files[index]);
  }
  return element.offsetHeight;
}
