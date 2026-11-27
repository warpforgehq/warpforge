import { daemon } from "@/daemon";

/**
 * What the sidebar panel is narrowed to. A project today; a space (several
 * projects) will be another kind sharing the same mode.
 */
export type PanelScope = { kind: "project"; name: string };

/**
 * The projects a scope covers, in display order.
 * @param scope the panel scope, or null for every project
 * @returns the scoped project names, or null when unscoped
 */
export function scopeProjects(scope: PanelScope | null): string[] | null {
  return scope ? [scope.name] : null;
}

/**
 * The project of a task the daemon knows about.
 * @param taskId the task id
 * @returns its project, or null when the task is unknown or projectless
 */
export function taskProject(taskId: string): string | null {
  const tasks = daemon.getState?.().snapshot?.tasks ?? [];
  return tasks.find((task) => task.id === taskId)?.project || null;
}

/**
 * Whether a task belongs inside the scope the panel shows.
 * @param scope the current panel scope
 * @param taskId the task about to be shown
 * @returns true when unscoped, or when the task's project is in scope
 */
export function scopeHolds(scope: PanelScope | null, taskId: string): boolean {
  const projects = scopeProjects(scope);
  if (!projects) return true;
  const project = taskProject(taskId);
  return project !== null && projects.includes(project);
}
