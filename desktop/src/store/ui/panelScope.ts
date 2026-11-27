import { daemon } from "@/daemon";
import type { Space } from "@/protocol";

/** What the sidebar panel is narrowed to: one project, or a space of several. */
export type PanelScope = { kind: "project"; name: string } | { kind: "space"; id: string };

function knownSpaces(): Space[] {
  return daemon.getState?.().snapshot?.spaces ?? [];
}

/**
 * The registered projects a space lists, in its order.
 * @param space the space
 * @returns names of its project members
 */
export function spaceProjectNames(space: Space): string[] {
  return space.members.flatMap((member) => (member.kind === "project" ? [member.name] : []));
}

/**
 * The space a project belongs to, if any.
 * @param project the project name
 * @param spaces spaces to search; the daemon's when omitted
 * @returns the space, or undefined
 */
export function spaceOfProject(
  project: string,
  spaces: Space[] = knownSpaces(),
): Space | undefined {
  return spaces.find((space) => spaceProjectNames(space).includes(project));
}

/**
 * The projects a scope covers, in display order.
 * @param scope the panel scope, or null for every project
 * @param spaces spaces to resolve a space scope against; the daemon's when omitted
 * @returns the scoped project names, or null when unscoped
 */
export function scopeProjects(
  scope: PanelScope | null,
  spaces: Space[] = knownSpaces(),
): string[] | null {
  if (!scope) return null;
  if (scope.kind === "project") return [scope.name];
  const space = spaces.find((candidate) => candidate.id === scope.id);
  return space ? spaceProjectNames(space) : [];
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
