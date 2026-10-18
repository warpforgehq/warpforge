/** Projects picked for a Smith: the home project and every project it may
 *  work in, home first. */
export interface ProjectSelection {
  home: string | null;
  /** Home first, then the rest in the order they were picked. */
  projects: string[];
}

function ordered(home: string | null, projects: string[]): string[] {
  return home ? [home, ...projects.filter((p) => p !== home)] : projects;
}

/**
 * Pick or unpick a project. The first picked becomes home; unpicking home
 * hands it to the next picked project.
 * @param selection the current pick
 * @param project the project clicked
 * @returns the new pick
 */
export function toggleProject(selection: ProjectSelection, project: string): ProjectSelection {
  if (selection.projects.includes(project)) {
    const projects = selection.projects.filter((p) => p !== project);
    const home = selection.home === project ? (projects[0] ?? null) : selection.home;
    return { home, projects: ordered(home, projects) };
  }
  const home = selection.home ?? project;
  return { home, projects: ordered(home, [...selection.projects, project]) };
}

/**
 * @param selection the current pick
 * @param project a picked project
 * @returns the pick with that project as home
 */
export function makeHome(selection: ProjectSelection, project: string): ProjectSelection {
  if (!selection.projects.includes(project)) return selection;
  return { home: project, projects: ordered(project, selection.projects) };
}
