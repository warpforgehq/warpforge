import type { Channel, PeerMessage } from "../protocol";

/** A channel in a project's part of the Smiths sidebar. */
export interface TeamChannel {
  project: string;
  /** A named channel's id, or `general`. */
  id: string;
  /** Shown as `#name`. */
  name: string;
  /** The feed thread it opens (`conversationKey`). */
  key: string;
  /** The named channel; absent for `#general`. */
  channel?: Channel;
}

/** The channel every project has: the project channel of ADR 0026. */
export const GENERAL = "general";

/**
 * @param project the project
 * @param channelId a named channel's id; absent for `#general`
 * @returns the key of that channel's feed thread
 */
export function channelKey(project: string, channelId?: string | null): string {
  return channelId ? `${project}::ch::${channelId}` : `${project}::team`;
}

/**
 * @param project the project
 * @param named the daemon's named channels, any project
 * @returns `#general` first, then the project's named channels by name
 */
export function projectChannels(project: string, named: Iterable<Channel> = []): TeamChannel[] {
  const general: TeamChannel = { id: GENERAL, key: channelKey(project), name: GENERAL, project };
  const rest = [...named]
    .filter((channel) => channel.project === project && channel.name !== GENERAL)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((channel) => ({
      channel,
      id: channel.id,
      key: channelKey(project, channel.id),
      name: channel.name,
      project,
    }));
  return [general, ...rest];
}

const NAME_MAX = 32;

/**
 * The daemon's channel name rule: one lowercase word, unique in its project.
 * @param name the proposed name, without `#`
 * @param taken the project's other channel names
 * @returns why it cannot be a channel's name, or null when it can
 */
export function channelNameError(name: string, taken: string[] = []): string | null {
  if (!name) return "A channel needs a name.";
  if (name.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters.`;
  if (!/^[a-z0-9_-]+$/.test(name)) return "Use one lowercase word: a–z, 0–9, - or _.";
  if (name === GENERAL || taken.includes(name)) return `#${name} already exists in this project.`;
  return null;
}

/**
 * Posts in one channel since it was last open, the user's own left out.
 * @param records feed records
 * @param key the channel's feed key
 * @param seenAt unix seconds it was last open
 * @returns how many are unread
 */
export function channelUnread(records: Iterable<PeerMessage>, key: string, seenAt: number): number {
  let count = 0;
  for (const record of records) {
    if (record.toTask || !record.fromTask || record.createdAt <= seenAt) continue;
    if (channelKey(record.project, record.channelId) === key) count += 1;
  }
  return count;
}
