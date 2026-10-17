/** Named channels in a project (ADR 0026 addendum). `#general` is implicit:
 *  a record with no `channelId` belongs to it. */

export interface ChannelMember {
  smithId: string;
  name: string;
}

export interface Channel {
  id: string;
  project: string;
  /** One lowercase word, unique in its project; never `general`. */
  name: string;
  members: ChannelMember[];
  createdAt: number;
  /** When the newest post the daemon still holds was made. */
  lastPostAt?: number;
}
