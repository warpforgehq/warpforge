import type { PullRequestSummary, TaskInfo } from "@/protocol";

/**
 * The Assistant tab's conversation is a real task (that is what persists it),
 * but not board work. `origin` says who created it; every board-shaped list
 * filters through the helpers here rather than open-coding the string.
 */
export const PR_REVIEW_ORIGIN = "pr-review";

/** True for a task that belongs to a surface rather than to the board. */
export function isSurfaceOwnedTask(task: Pick<TaskInfo, "origin">): boolean {
  return !!task.origin;
}

/** The board's view of the task list: everything a surface does not own. */
export function boardTasks(tasks: readonly TaskInfo[]): TaskInfo[] {
  return tasks.filter((task) => !isSurfaceOwnedTask(task));
}

/** `repo#number`, not the project name: one repo can be checked out under
 *  several projects — the same key `inboxSeen` and `pullViewed` use. */
export function prTaskTag(pr: Pick<PullRequestSummary, "repo" | "number">): string {
  return `pr:${pr.repo}#${pr.number}`;
}

/** A shadow task is "working" while the daemon has it queued or running. */
export function isPrAssistantRunning(task: Pick<TaskInfo, "status">): boolean {
  return task.status === "running" || task.status === "queued";
}

/** What a PR row must say about its assistant: work in flight, a review that
 *  finished and has not been opened, or nothing. */
export type PrAssistantState = "running" | "unseen";

let indexedTasks: readonly TaskInfo[] | null = null;
let indexedAssistantTasks: ReadonlyMap<string, TaskInfo> = new Map();

/**
 * One pass over `snapshot.tasks`, keyed by `prTaskTag`, newest task winning.
 * The sidebar renders dozens of PR rows, so the per-row lookup must not rescan
 * the task list; the result is cached against the tasks array's identity, which
 * the daemon only replaces when the task set actually moves.
 */
export function prAssistantTaskIndex(tasks: readonly TaskInfo[]): ReadonlyMap<string, TaskInfo> {
  if (indexedTasks === tasks) return indexedAssistantTasks;
  const index = new Map<string, TaskInfo>();
  for (const task of tasks) {
    if (task.origin !== PR_REVIEW_ORIGIN) continue;
    const tag = task.tags.find((candidate) => candidate.startsWith("pr:"));
    if (!tag) continue;
    const current = index.get(tag);
    if (!current || task.createdAt > current.createdAt) index.set(tag, task);
  }
  indexedTasks = tasks;
  indexedAssistantTasks = index;
  return index;
}

/** Reopen-not-spawn: the pane's only way to resolve its task. Newest wins,
 *  so a duplicate from two windows racing resolves the same for both. */
export function findPrAssistantTask(
  tasks: readonly TaskInfo[],
  pr: Pick<PullRequestSummary, "repo" | "number">,
): TaskInfo | null {
  return prAssistantTaskIndex(tasks).get(prTaskTag(pr)) ?? null;
}

/** The pull request a shadow task belongs to, read back off its tags. */
export function prTaskRef(task: Pick<TaskInfo, "tags">): { repo: string; number: number } | null {
  for (const tag of task.tags) {
    if (!tag.startsWith("pr:")) continue;
    const cut = tag.lastIndexOf("#");
    const number = Number(tag.slice(cut + 1));
    if (cut < 3 || !Number.isInteger(number)) continue;
    return { number, repo: tag.slice(3, cut) };
  }
  return null;
}

/** Shadow tasks the listing does not carry, so their state must be asked for.
 *  `checked` + `budget` keep it cheap: a merged PR drops out of the default
 *  `open` listing, so absence is the common case. */
export function unverifiedPrAssistantTasks(
  tasks: readonly TaskInfo[],
  pulls: readonly PullRequestSummary[],
  checked: ReadonlySet<string>,
  budget: number,
): TaskInfo[] {
  const listed = new Set(pulls.map((pr) => prTaskTag(pr)));
  const pending: TaskInfo[] = [];
  for (const task of tasks) {
    if (task.origin !== PR_REVIEW_ORIGIN || task.status === "done") continue;
    if (checked.has(task.id)) continue;
    const tag = task.tags.find((candidate) => candidate.startsWith("pr:"));
    if (!tag || listed.has(tag)) continue;
    pending.push(task);
    if (pending.length >= budget) break;
  }
  return pending;
}

/** Shadow tasks whose PR the listing shows as closed — what the pull-refresh
 *  path archives. Absence proves nothing (the default filter is `open`), so
 *  those wait for the daemon's TTL sweep. */
export function closedPrAssistantTasks(
  tasks: readonly TaskInfo[],
  pulls: readonly PullRequestSummary[],
): TaskInfo[] {
  const closed = new Set(pulls.filter((pr) => pr.state !== "open").map((pr) => prTaskTag(pr)));
  if (closed.size === 0) return [];
  return tasks.filter(
    (task) =>
      task.origin === PR_REVIEW_ORIGIN &&
      task.status !== "done" &&
      task.tags.some((tag) => closed.has(tag)),
  );
}
