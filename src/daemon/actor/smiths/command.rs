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
    /// A work session as the Smith, from the user (ADR 0027).
    StartWork {
        id: String,
        project: String,
        brief: String,
        backlog_item_id: Option<String>,
        worktree: bool,
        /// Run it as an orchestrator lead.
        orchestrator: bool,
        reply: Reply<String>,
    },
    /// The minute timer: look for identity edits made outside the daemon.
    Tick,
    /// Which Smiths' identity files no longer match the revs they were
    /// checked against.
    IdentityChecked {
        changed: Vec<(String, Revs)>,
    },
    /// `start_work` from a Smith's session, within the daemon's limits.
    StartWorkFrom {
        from: String,
        target: String,
        project: String,
        brief: String,
        backlog_item_id: Option<String>,
        worktree: bool,
        reply: Reply<(String, String)>,
    },
    /// Test-only: give the daemon a throwaway memory store.
    #[cfg(test)]
    UseMemory {
        path: std::path::PathBuf,
    },
    /// Test-only: say whether the Claude adapter reads `_meta.systemPrompt`.
    #[cfg(test)]
    SetClaudeMeta {
        on: bool,
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
