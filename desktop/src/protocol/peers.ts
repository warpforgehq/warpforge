/** Peer sessions (ADR 0026): the feed's records and the user's holds. */

export type PeerMessageStatus = "queued" | "held" | "posted" | "delivered" | "refused";

/** One attempt to message a peer or post to a project's channel. */
export interface PeerMessage {
  /** Increases with every record, so it orders and pages the feed. */
  id: number;
  project: string;
  /** Absent when the user sent it. */
  fromTask?: string;
  /** Absent for a channel post. */
  toTask?: string;
  text: string;
  createdAt: number;
  deliveredAt?: number;
  status: PeerMessageStatus;
  reason?: string;
  /** The first refusal of a pair's message window. */
  alert?: boolean;
  /** An alert is live while this is absent. */
  alertClearedAt?: number;
  /** The sessions a post reached through its @mentions. */
  mentions?: string[];
  /** The post a mention's direct message, or a "started" line, came from. */
  sourceId?: number;
  /** Set on the line recording a session the user started from a post. */
  startedTask?: string;
  /** The named channel a post went to; absent is `#general`. */
  channelId?: string;
}

export interface PeerControls {
  mutedTasks: string[];
  pausedProjects: string[];
}

export interface PeerSendResult {
  relation: "child" | "peer" | "team";
  message?: PeerMessage;
  /** The receiver's label, for a direct message. */
  toLabel?: string;
  /** What the sender should know about delivery, when it is not immediate. */
  notice?: string;
}
