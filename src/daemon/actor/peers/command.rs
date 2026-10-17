use tokio::sync::oneshot;

use warpforge_protocol as wire;

type Reply<T> = oneshot::Sender<Result<T, String>>;

pub enum PeerCommand {
    /// The sessions `task_id` can see in its project.
    List {
        task_id: String,
        reply: Reply<Vec<wire::PeerInfo>>,
    },
    /// A page of feed records, newest first; read off the actor loop.
    Feed {
        project: Option<String>,
        before: Option<u64>,
        limit: Option<u32>,
        /// A channel id, or `general`; every channel when absent.
        channel: Option<String>,
        reply: Reply<Vec<wire::PeerMessage>>,
    },
    /// The records whose alert is live, from actor memory.
    Alerts {
        reply: Reply<Vec<wire::PeerMessage>>,
    },
    Controls {
        reply: Reply<wire::PeerControls>,
    },
    SetMuted {
        task_id: String,
        muted: bool,
        reply: Reply<wire::PeerControls>,
    },
    SetPaused {
        project: String,
        paused: bool,
        reply: Reply<wire::PeerControls>,
    },
    SetStatusNote {
        task_id: String,
        text: String,
        reply: Reply<()>,
    },
    /// `session.message`: route to a child, a peer or the team channel.
    Message {
        from_task_id: String,
        to: String,
        message: String,
        reply: Reply<wire::PeerSendResult>,
    },
    /// The user posts to a project's channel; @mentions become user prompts.
    UserPost {
        project: String,
        text: String,
        /// A named channel; `#general` when absent.
        channel_id: Option<String>,
        reply: Reply<wire::PeerSendResult>,
    },
    /// The user messages one session from the Team view.
    UserMessage {
        task_id: String,
        text: String,
        reply: Reply<wire::PeerSendResult>,
    },
    /// The user started `task_id` from the post `source_id`.
    UserStarted {
        task_id: String,
        source_id: Option<u64>,
        reply: Reply<wire::PeerMessage>,
    },
    ChannelsList {
        project: Option<String>,
        task_id: Option<String>,
        reply: Reply<Vec<wire::Channel>>,
    },
    ChannelsCreate {
        project: String,
        name: String,
        reply: Reply<wire::Channel>,
    },
    ChannelsRename {
        id: String,
        name: String,
        reply: Reply<wire::Channel>,
    },
    ChannelsDelete {
        id: String,
        reply: Reply<()>,
    },
    /// Add (`member`) or remove a Smith.
    ChannelsSetMember {
        id: String,
        smith_id: String,
        member: bool,
        reply: Reply<wire::Channel>,
    },
    /// Test-only: the (project, channel) keys of the posts kept for digests.
    #[cfg(test)]
    PostKeys {
        reply: oneshot::Sender<Vec<(String, Option<String>)>>,
    },
    /// The minute timer: let lapsed guard limits go and end their alerts.
    Tick,
}
