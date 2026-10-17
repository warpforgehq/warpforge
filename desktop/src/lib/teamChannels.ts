/** A channel in a project's part of the Team sidebar. */
export interface TeamChannel {
  project: string;
  /** Stable within its project. */
  id: string;
  /** Shown as `#name`. */
  name: string;
  /** The feed thread it opens (`conversationKey`). */
  key: string;
}

/** The default channel every project has: the channel of ADR 0026. */
export const GENERAL = "general";

/** Off until the daemon serves named channels (backlog #126). */
export const NAMED_CHANNELS = false;

/**
 * @param project the project
 * @param named channels the daemon reports beyond the default one
 * @returns `#general` first, then the rest by name
 */
export function projectChannels(
  project: string,
  named: Omit<TeamChannel, "project">[] = [],
): TeamChannel[] {
  const general: TeamChannel = { id: GENERAL, key: `${project}::team`, name: GENERAL, project };
  const rest = named
    .filter((channel) => channel.id !== GENERAL)
    .map((channel) => ({ ...channel, project }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [general, ...rest];
}
