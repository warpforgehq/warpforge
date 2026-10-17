import type { Channel, PeerControls, PeerMessage, PeerSendResult } from "../protocol";
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

    /** Every record whose message-limit alert is live, however old. */
    async peerAlerts(): Promise<PeerMessage[]> {
      const result = await this.request("peers.alerts", {});
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
    async postToTeam(
      project: string,
      text: string,
      channelId?: string | null,
    ): Promise<PeerSendResult> {
      return (await this.request("peers.userPost", {
        channel_id: channelId ?? null,
        project,
        text,
      })) as PeerSendResult;
    }

    /** Message one session as the user: a normal prompt with a feed record. */
    async messageSession(taskId: string, text: string): Promise<PeerSendResult> {
      return (await this.request("peers.userMessage", { task_id: taskId, text })) as PeerSendResult;
    }

    /** Named channels; `#general` is implicit and not listed. */
    async listChannels(project?: string | null): Promise<Channel[]> {
      const result = await this.request("channels.list", { project: project ?? null });
      const channels = (result as { channels?: Channel[] })?.channels;
      return Array.isArray(channels) ? channels : [];
    }

    async createChannel(project: string, name: string): Promise<Channel> {
      return (await this.request("channels.create", { name, project })) as Channel;
    }

    async renameChannel(id: string, name: string): Promise<Channel> {
      return (await this.request("channels.rename", { id, name })) as Channel;
    }

    /** Its posts stay in the feed and reach no session again. */
    async deleteChannel(id: string): Promise<void> {
      await this.request("channels.delete", { id });
    }

    async addChannelMember(id: string, smithId: string): Promise<Channel> {
      return (await this.request("channels.addMember", { id, smith_id: smithId })) as Channel;
    }

    async removeChannelMember(id: string, smithId: string): Promise<Channel> {
      return (await this.request("channels.removeMember", { id, smith_id: smithId })) as Channel;
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
