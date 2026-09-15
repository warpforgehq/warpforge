export const fileAnchor = (path: string) => `diff-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;

export const hunkAnchor = (path: string, index: number) => `${fileAnchor(path)}-hunk-${index}`;

/** Stable hunk identity for the session cache — never a virtualizer row index. */
export const hunkKey = (hunk: {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}) => `${hunk.oldStart}:${hunk.oldLines}:${hunk.newStart}:${hunk.newLines}`;

