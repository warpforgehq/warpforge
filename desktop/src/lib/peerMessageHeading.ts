import type { SessionUpdate } from "../protocol";

type PeerMessage = Extract<SessionUpdate, { kind: "peer_message" }>;

/**
 * The heading, and the task a click opens, for one peer message entry.
 * @param update the transcript entry
 * @returns the heading text, and the other task's id and name when there is one to open
 */
export function peerMessageHeading(update: PeerMessage): {
  title: string;
  target?: { id: string; label: string };
} {
  switch (update.direction) {
    case "sent": {
      const label = update.to_label ?? "team";
      return {
        title: `To ${label}`,
        target: update.to_task ? { id: update.to_task, label } : undefined,
      };
    }
    case "received":
      return {
        title: `From ${update.from_label}`,
        target: update.from_task ? { id: update.from_task, label: update.from_label } : undefined,
      };
    default:
      return { title: update.from_label || "Team digest" };
  }
}
