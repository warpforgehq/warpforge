use tokio::sync::oneshot;

use warpforge_protocol as wire;

use crate::daemon::smiths::identity::{Identity, Revs};

type Reply<T> = oneshot::Sender<Result<T, String>>;

pub enum SmithCommand {
    List {
        reply: Reply<Vec<wire::Smith>>,
    },
    /// With its identity files, read off the actor loop.
    Get {
        id: String,
        reply: Reply<wire::SmithDetail>,
    },
    Create {
        create: Box<wire::SmithCreate>,
        reply: Reply<wire::SmithDetail>,
    },
    Update {
        id: String,
        patch: Box<wire::SmithPatch>,
        reply: Reply<wire::SmithDetail>,
    },
    SetPaused {
        id: String,
        paused: bool,
        reply: Reply<wire::Smith>,
    },
    Delete {
        id: String,
        reply: Reply<()>,
    },
    /// Commit an out-of-band identity edit and lift the hold.
    AcceptIdentity {
        id: String,
        reply: Reply<wire::SmithDetail>,
    },
    /// Discard an out-of-band identity edit and lift the hold.
    RevertIdentity {
        id: String,
        reply: Reply<wire::SmithDetail>,
    },
    /// A new Smith's identity repo was written, or could not be.
    Created {
        smith: Box<wire::Smith>,
        result: Result<(Revs, Identity), String>,
        reply: Reply<wire::SmithDetail>,
    },
    /// An edit, accept or revert of the identity repo finished.
    IdentityWritten {
        id: String,
        result: Result<(Revs, Identity), String>,
        /// The rest of an edit, applied once the files are written.
        patch: Option<Box<wire::SmithPatch>>,
        reply: Reply<wire::SmithDetail>,
    },
}
