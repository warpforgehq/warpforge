import type { PeerControls, PeerMessage, PeerSendResult } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function PeerMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  // ── Peer session RPCs (ADR 0026) ──
  // The feed is absent from the connect snapshot; the Team store pages it and
  // then stays live off `peer.messageUpdated`.
  return class extends Base {
    async peerFeed(
      options: { project?: string | null; before?: number | null; limit?: number } = {},
    ): Promise<PeerMessage[]> {
      const result = await this.request("peers.feed", {
        before: options.before ?? null,
        limit: options.limit ?? null,
        project: options.project ?? null,
      });
      const messages = (result as { messages?: PeerMessage[] })?.messages;
      return Array.isArray(messages) ? messages : [];
    }

    async peerControls(): Promise<PeerControls> {
      return (await this.request("peers.controls", {})) as PeerControls;
    }

    async setPeerMuted(taskId: string, muted: boolean): Promise<PeerControls> {
      return (await this.request("peers.setMuted", { muted, task_id: taskId })) as PeerControls;
    }

    async setPeerPaused(project: string, paused: boolean): Promise<PeerControls> {
      return (await this.request("peers.setPaused", { paused, project })) as PeerControls;
    }

    /** Post to a project's channel as the user; each @mentioned session gets
     *  the post as a user prompt. */
    async postToTeam(project: string, text: string): Promise<PeerSendResult> {
      return (await this.request("peers.userPost", { project, text })) as PeerSendResult;
    }

    /** Message one session as the user: a normal prompt with a feed record. */
    async messageSession(taskId: string, text: string): Promise<PeerSendResult> {
      return (await this.request("peers.userMessage", { task_id: taskId, text })) as PeerSendResult;
    }

    /** Record in the channel that the user started `taskId` from a post. */
    async recordStartedFromPost(taskId: string, sourceId: number | null): Promise<PeerMessage> {
      return (await this.request("peers.userStarted", {
        source_id: sourceId,
        task_id: taskId,
      })) as PeerMessage;
    }
  };
}
