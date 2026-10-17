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
}
