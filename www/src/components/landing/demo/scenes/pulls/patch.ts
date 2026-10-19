import type { PullRequestDiff, PullRequestFile, TaskDiff } from "@app/protocol";

export interface PatchFile {
  path: string;
  /** Lines with their `+`, `-` or ` ` prefix, as one hunk. */
  lines: string[];
  /** Where the hunk starts in the old file; 0 for a file the PR adds. */
  oldStart: number;
  newStart?: number;
}

const count = (lines: string[], sign: string) => lines.filter((l) => l.startsWith(sign)).length;

function stats(file: PatchFile): PullRequestFile {
  return { additions: count(file.lines, "+"), deletions: count(file.lines, "-"), path: file.path };
}

function spans(file: PatchFile) {
  return {
    newLines: file.lines.length - count(file.lines, "-"),
    newStart: file.newStart ?? Math.max(file.oldStart, 1),
    oldLines: file.lines.length - count(file.lines, "+"),
    oldStart: file.oldStart,
  };
}

function block(file: PatchFile): string {
  const added = file.oldStart === 0;
  const { newLines, newStart, oldLines } = spans(file);
  return [
    `diff --git a/${file.path} b/${file.path}`,
    ...(added ? ["new file mode 100644"] : []),
    `--- ${added ? "/dev/null" : `a/${file.path}`}`,
    `+++ b/${file.path}`,
    `@@ -${file.oldStart},${oldLines} +${newStart},${newLines} @@`,
    ...file.lines,
  ].join("\n");
}

/**
 * A pull request's diff as `tracker.pulls.diff` answers it.
 * @param files The changed files, one hunk each.
 * @returns File stats and the unified patch they add up to.
 */
export function pullDiff(files: PatchFile[]): PullRequestDiff {
  const fileStats = files.map(stats);
  return {
    additions: fileStats.reduce((sum, file) => sum + file.additions, 0),
    deletions: fileStats.reduce((sum, file) => sum + file.deletions, 0),
    files: fileStats,
    patch: `${files.map(block).join("\n")}\n`,
    truncated: false,
  };
}

/**
 * The same change as the task's working copy reports it.
 * @param files The changed files, one hunk each.
 * @param taskId The task whose worktree holds them.
 * @param branch The worktree's branch.
 * @returns What `diff.get` answers.
 */
export function taskDiff(files: PatchFile[], taskId: string, branch: string): TaskDiff {
  return {
    branch,
    files: files.map((file) => ({
      hunks: [{ ...spans(file), lines: file.lines, resolution: null }],
      oldPath: null,
      path: file.path,
      status: file.oldStart === 0 ? ("added" as const) : ("modified" as const),
    })),
    ignored: [],
    ignoredAvailable: true,
    ignoredTruncated: false,
    taskId,
    untrackedAvailable: true,
    untrackedPaths: [],
  };
}
