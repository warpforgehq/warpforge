/**
 * The project the Smiths sidebar shows: the one the user picked there, else
 * the project open in Tasks, else the first.
 * @param picked the project picked in the Smiths sidebar, if any
 * @param projects the registered projects
 * @param openProject the project open in Tasks (selected, or the open task's)
 * @returns the project, or null when none is registered
 */
export function resolveSmithsProject(
  picked: string | null,
  projects: string[],
  openProject: string | null,
): string | null {
  if (picked && projects.includes(picked)) return picked;
  if (openProject && projects.includes(openProject)) return openProject;
  return projects[0] ?? null;
}
