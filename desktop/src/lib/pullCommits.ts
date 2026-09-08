import type { PullCommit } from "@/protocol";

/**
 * A slice of a pull request's commits, named by two hashes: the comparison
 * runs from `fromOid` (exclusive — the first selected commit's parent) to
 * `toOid` (inclusive). `null` means the whole pull request.
 *
 * Two hashes rather than a list of them because that is what GitHub can
 * actually answer: there is no "diff of these three commits" endpoint, only a
 * comparison between two points. Which is also why a selection is a
 * contiguous span — a diff of commits 1 and 3 without 2 is not a thing that
 * exists, and offering it would mean showing a patch nobody asked for.
 */
export interface CommitRange {
  fromOid: string;
  toOid: string;
}

/**
 * Which commits a range covers, as indexes into `commits` (oldest first).
 * Empty means "all of them": either no range is set, or the range no longer
 * matches the list — after a force-push, say — in which case falling back to
 * the whole pull request is the honest answer.
 */
export function selectedCommitIndexes(
  commits: readonly PullCommit[],
  range: CommitRange | null,
): number[] {
  if (!range) return [];
  const start = commits.findIndex((commit) => commit.parentOid === range.fromOid);
  const end = commits.findIndex((commit) => commit.oid === range.toOid);
  if (start < 0 || end < 0 || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

/** The range covering `start..=end`, or null when it cannot be compared —
 *  a first commit with no parent has nothing to diff against. */
export function commitSpanRange(
  commits: readonly PullCommit[],
  start: number,
  end: number,
): CommitRange | null {
  const first = commits[Math.min(start, end)];
  const last = commits[Math.max(start, end)];
  if (!first || !last || !first.parentOid) return null;
  return { fromOid: first.parentOid, toOid: last.oid };
}

/**
 * Clicking one commit's checkbox.
 *
 * With everything selected, a click narrows to that one commit — the common
 * move is "show me just this". Clicking the only selected commit goes back to
 * all of them. Clicking an end of the span shrinks it from that end, an
 * interior one narrows to it, and anything outside grows the span to reach it,
 * so a two-click pick of the first and last commit selects the run between
 * them the way a file list does.
 */
export function toggleCommitInRange(
  commits: readonly PullCommit[],
  range: CommitRange | null,
  index: number,
): CommitRange | null {
  const selected = selectedCommitIndexes(commits, range);
  if (selected.length === 0) return commitSpanRange(commits, index, index);
  const first = selected[0];
  const last = selected[selected.length - 1];
  if (index < first || index > last) {
    return commitSpanRange(commits, Math.min(index, first), Math.max(index, last));
  }
  if (first === last) return null;
  if (index === first) return commitSpanRange(commits, first + 1, last);
  if (index === last) return commitSpanRange(commits, first, last - 1);
  return commitSpanRange(commits, index, index);
}

/** What the toolbar's pill says: the count it is diffing, not the count that
 *  exists, because that is the number the reviewer needs to see. */
export function commitRangeLabel(
  commits: readonly PullCommit[],
  range: CommitRange | null,
): string {
  const selected = selectedCommitIndexes(commits, range);
  const count = selected.length || commits.length;
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}
