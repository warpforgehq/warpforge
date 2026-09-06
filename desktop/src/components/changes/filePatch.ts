import type { FileDiff } from "../../protocol";

/**
 * Minimal unified diff of one file, for "Copy as Patch to Clipboard". Same
 * shape as the patches the daemon feeds to `git apply` (`--- a/old`,
 * `+++ b/path`, one `@@` block per hunk), so what lands in the clipboard
 * applies cleanly with `git apply` / `patch -p1`.
 */
export function toUnifiedPatch(file: FileDiff): string {
  const old = file.oldPath ?? file.path;
  const out = [`--- a/${old}`, `+++ b/${file.path}`];
  for (const hunk of file.hunks) {
    out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    out.push(...hunk.lines);
  }
  return `${out.join("\n")}\n`;
}
