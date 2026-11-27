import type { ProjectSurface } from "@/store/ui/types";

/** Every project section, in the built-in order. */
export const PROJECT_SECTION_IDS: readonly ProjectSurface[] = [
  "backlog",
  "pulls",
  "files",
  "runtime",
  "terminal",
  "worktrees",
  "config",
];

/** Which project sections the panel lists, and in what order. One global preference. */
export interface ProjectSectionPrefs {
  /** Sections in the order shown; ones missing from it follow in built-in order. */
  order: ProjectSurface[];
  hidden: ProjectSurface[];
}

export const DEFAULT_PROJECT_SECTION_PREFS: ProjectSectionPrefs = { order: [], hidden: [] };

/**
 * Every section in the user's order.
 * @param prefs the preference
 * @returns all section ids, ordered
 */
export function orderedSections(prefs: ProjectSectionPrefs): ProjectSurface[] {
  const known = prefs.order.filter((id) => PROJECT_SECTION_IDS.includes(id));
  return [...new Set([...known, ...PROJECT_SECTION_IDS])];
}

/**
 * The sections the panel lists. Never empty: with everything hidden the first one shows.
 * @param prefs the preference
 * @returns visible section ids, ordered
 */
export function visibleSections(prefs: ProjectSectionPrefs): ProjectSurface[] {
  const ordered = orderedSections(prefs);
  const visible = ordered.filter((id) => !prefs.hidden.includes(id));
  return visible.length > 0 ? visible : ordered.slice(0, 1);
}

/**
 * The section to show: the remembered one if still visible, else the first visible.
 * @param remembered the project's remembered section, if any
 * @param prefs the preference
 * @returns the section to render
 */
export function resolveSection(
  remembered: ProjectSurface | undefined,
  prefs: ProjectSectionPrefs,
): ProjectSurface {
  const visible = visibleSections(prefs);
  return remembered && visible.includes(remembered) ? remembered : visible[0]!;
}

/**
 * Hide or show a section, refusing to hide the last visible one.
 * @param prefs the current preference
 * @param id the section
 * @param hidden whether it should be hidden
 * @returns the next preference
 */
export function withSectionHidden(
  prefs: ProjectSectionPrefs,
  id: ProjectSurface,
  hidden: boolean,
): ProjectSectionPrefs {
  if (!hidden) return { ...prefs, hidden: prefs.hidden.filter((other) => other !== id) };
  const visible = visibleSections(prefs);
  if (visible.length <= 1 || !visible.includes(id)) return prefs;
  return { ...prefs, hidden: [...prefs.hidden, id] };
}

/**
 * Move a section up or down one place.
 * @param prefs the current preference
 * @param id the section
 * @param delta -1 for up, 1 for down
 * @returns the next preference
 */
export function withSectionMoved(
  prefs: ProjectSectionPrefs,
  id: ProjectSurface,
  delta: -1 | 1,
): ProjectSectionPrefs {
  const order = orderedSections(prefs);
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return prefs;
  [order[from], order[to]] = [order[to]!, order[from]!];
  return { ...prefs, order };
}
