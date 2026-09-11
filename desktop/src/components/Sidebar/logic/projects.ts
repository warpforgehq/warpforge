import { isSettledTask } from "@/lib/taskGroups";
import type { TaskInfo } from "@/protocol";

/**
 * Registered projects only. A task can outlive its project — removing a
 * project stops its live resources but does not touch its tasks (see
 * `remove_project` in the daemon) — and such a task must not resurrect its
 * project as a phantom group here. Its tasks simply don't render in the
 * sidebar tree; the daemon still holds them.
 */
export function projectNames(input: { projects: readonly { name: string }[] }): string[] {
  return input.projects.map((project) => project.name);
}

/**
 * NaN-safe read of a Warpforge timestamp (unix **seconds**, not an ISO string).
 * A single bad value must not reach the comparator: one `NaN` in a `Math.max`
 * chain makes every later comparison false, which silently randomises the whole
 * order rather than failing loudly.
 */
function sortableSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * How recently a project saw activity, for ordering the sidebar.
 *
 * Only **live** tasks count. A project full of finished work would otherwise
 * outrank one being worked in right now, which defeats the point — but a
 * project whose tasks have all settled still needs a defined key, so it falls
 * back to its archive rather than sinking to `-Infinity` next to the genuinely
 * empty ones.
 *
 * Returns `null` when the project has no usable timestamp at all. Warpforge's
 * `ProjectInfo` carries no `createdAt`/`updatedAt`, so an empty project has
 * nothing to fall back to and simply sorts last, alphabetically.
 */
export function projectActivityAt(name: string, tasks: readonly TaskInfo[]): number | null {
  let live: number | null = null;
  let settled: number | null = null;
  for (const task of tasks) {
    if (task.project !== name) continue;
    const at = sortableSeconds(task.updatedAt);
    if (at === null) continue;
    if (isSettledTask(task)) {
      if (settled === null || at > settled) settled = at;
    } else if (live === null || at > live) {
      live = at;
    }
  }
  return live ?? settled;
}

/**
 * Most recently active project first, so whatever the user is working in floats
 * to the top.
 *
 * Ties break by name, which is total and stable: with no second key, two
 * projects sharing a timestamp could swap places on an unrelated re-render and
 * the list would visibly twitch. Callers should recompute this only when the
 * task set changes — never on a clock tick — or a row can slide out from under
 * the pointer mid-click.
 */
export function sortProjectsByActivity(
  names: readonly string[],
  tasks: readonly TaskInfo[],
): string[] {
  const activity = new Map(names.map((name) => [name, projectActivityAt(name, tasks)]));
  return [...names].sort((a, b) => {
    const left = activity.get(a) ?? Number.NEGATIVE_INFINITY;
    const right = activity.get(b) ?? Number.NEGATIVE_INFINITY;
    if (left !== right) return right - left;
    return a.localeCompare(b);
  });
}
