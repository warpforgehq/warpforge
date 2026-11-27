//! Per-method policy consulted by the connection loop: which requests may be
//! answered off the read loop, and which the update gate must hold back.

use warpforge_protocol as wire;

/// Requests answered off the connection's read loop instead of ahead of
/// everything behind them.
///
/// The question is not whether a request writes — it is whether it has to be
/// ordered against the others on the connection. So this is its own list rather
/// than the negation of [`method_is_mutation`], which exists to decide what the
/// update gate holds back:
///
/// - Reads are independent by definition.
/// - So are one-shot jobs whose result depends on nothing else in flight:
///   generating a title, installing an agent or a language server. These are
///   the slowest things the daemon does — a title spawns an agent process with
///   a two-minute ceiling, an install shells out to a package manager — and
///   they are what made starting a task feel like it stalled everything else.
/// - Tracker pulls go to GitHub or Linear and can take seconds; held serial,
///   they kept the local backlog page queued behind them. Adoption dedups on
///   `(provider, external_id)` in the actor, so two pulls cannot double-import.
/// - Ordered work stays serial. LSP is a streaming protocol, so dispatching
///   `LspSend` concurrently would reorder a language server's inbox, and git
///   writes mean what they mean only in sequence: commit, then push.
pub(super) fn method_runs_concurrently(method: &wire::Method) -> bool {
    use wire::Method::*;
    matches!(
        method,
        AppQuitCheck {}
            | TextGenerate { .. }
            | AgentsInstall { .. }
            | AgentsSignInStart { .. }
            | AgentsSignInFinish { .. }
            | AgentsProbe { .. }
            | ChatCreateProject { .. }
            | SessionSetConfigOption { .. }
            | LanguageServersInstall { .. }
            | DiffGet { .. }
            | FileContents { .. }
            | FileList { .. }
            | DirList { .. }
            | ChatFolder { .. }
            | FileSearch { .. }
            | GitBranches { .. }
            | GitRoots { .. }
            | GitIgnored { .. }
            | GitStatus { .. }
            | GitBranchCommits { .. }
            | GitCommitDiff { .. }
            | GitPushInfo { .. }
            | GitLastCommitMessage { .. }
            | ServiceLogs { .. }
            | PortForwardLogs { .. }
            | RuntimeList { .. }
            | BrowserAct { .. }
            | HtmlPreview { .. }
            | AdvisorAsk { .. }
            | AdvisorWait { .. }
            | TaskListWorktrees { .. }
            | WorktreeList { .. }
            | WorktreeSetupLog { .. }
            | TaskPullRequests { .. }
            | WorktreeReclaim { .. }
            | WorktreeRemoveOrphan { .. }
            | SessionsList { .. }
            | SessionHistory { .. }
            | OrchestratorListAgents { .. }
            | AgentsDetect {}
            | AgentsList {}
            | AccountsList {}
            | OrchestrateList {}
            | OrchestrateGetConfig {}
            | WorkflowList { .. }
            | LanguageServersDetect {}
            | AutomationList { .. }
            | AutomationShow { .. }
            | AutomationRuns { .. }
            | RunnerStatus { .. }
            | RunnerBrief { .. }
            | RunnerRuns { .. }
            | PeersList { .. }
            | PeersFeed { .. }
            | PeersControls {}
            | ChannelsList { .. }
            | SmithsList {}
            | SmithsGet { .. }
            | KeepersList { .. }
            | KeepersState { .. }
            | TrackerPullsList { .. }
            | TrackerPullDetails { .. }
            | TrackerPullDiff { .. }
            | TrackerPullCommits { .. }
            | TrackerPullThread { .. }
            | TrackerPullChecks { .. }
            | TrackerStatus { .. }
            | TrackerProjectSources { .. }
            | TrackerLinearTeams { .. }
            | TrackerAttachment { .. }
            | TrackerLinks { .. }
            | BacklogList { .. }
            | WorkItemList { .. }
            | WorkItemImportExternal { .. }
    )
}

pub(super) fn method_is_mutation(method: &wire::Method) -> bool {
    use wire::Method::*;
    !matches!(
        method,
        SystemHandshake { .. }
            | AppQuitCheck {}
            | StateSubscribe { .. }
            | ServiceLogs { .. }
            | PortForwardLogs { .. }
            | RuntimeList { .. }
            | HtmlPreview { .. }
            | SpaceList {}
            | TaskListWorktrees { .. }
            | WorktreeList { .. }
            | WorktreeSetupLog { .. }
            | TaskPullRequests { .. }
            | SessionsList { .. }
            | SessionHistory { .. }
            | HistoryGetSettings {}
            | OrchestratorListAgents { .. }
            | AgentsList {}
            | AccountsList {}
            | DiffGet { .. }
            | FileContents { .. }
            | FileList { .. }
            | DirList { .. }
            | ChatFolder { .. }
            | FileSearch { .. }
            | GitBranches { .. }
            | GitRoots { .. }
            | GitIgnored { .. }
            | GitStatus { .. }
            | GitBranchCommits { .. }
            | GitCommitDiff { .. }
            | GitPushInfo { .. }
            | GitLastCommitMessage { .. }
            | OrchestrateList {}
            | OrchestrateGetConfig {}
            | WorkflowList { .. }
            | BootstrapFinalize { .. }
            | ProjectConfigRead { .. }
            | WorkItemList { .. }
            | LspStart { .. }
            | LspSend { .. }
            | LspStop { .. }
            | LanguageServersDetect {}
            | AutomationList { .. }
            | AutomationShow { .. }
            | AutomationRuns { .. }
            | RunnerStatus { .. }
            | RunnerBrief { .. }
            | RunnerRuns { .. }
            | PeersList { .. }
            | PeersFeed { .. }
            | PeersControls {}
            | ChannelsList { .. }
            | SmithsList {}
            | SmithsGet { .. }
            | KeepersList { .. }
            | KeepersState { .. }
            | TrackerPullsList { .. }
            | TrackerPullDetails { .. }
            | TrackerPullDiff { .. }
            | TrackerPullCommits { .. }
            | TrackerPullThread { .. }
            | TrackerPullChecks { .. }
    )
}

/// Methods that act as the user, for #120 to gate once the daemon can tell
/// the desktop from an agent. Listed now, enforced nowhere yet (ADR 0027).
pub(super) fn method_is_user_only(method: &wire::Method) -> bool {
    use wire::Method::*;
    matches!(
        method,
        SmithsCreate(..)
            | SmithsUpdate { .. }
            | SmithsSetPaused { .. }
            | SmithsDelete { .. }
            | SmithsAcceptIdentity { .. }
            | SmithsRevertIdentity { .. }
            | SmithsStartWork { .. }
            | ChannelsCreate { .. }
            | ChannelsRename { .. }
            | ChannelsDelete { .. }
            | ChannelsAddMember { .. }
            | ChannelsRemoveMember { .. }
            | KeepersDismiss { .. }
            | KeepersAcceptReply { .. }
            | KeepersDecide { .. }
            | KeepersSetSwitch { .. }
            | KeepersCheckReady { .. }
            | KeepersSendFindings { .. }
            | AgentsSignInStart { .. }
            | AgentsSignInFinish { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_smith_channel_and_keeper_edit_is_user_only_and_reads_are_not() {
        let id = || "sm_1".to_string();
        for method in [
            wire::Method::SmithsUpdate {
                id: id(),
                patch: Default::default(),
            },
            wire::Method::SmithsSetPaused {
                id: id(),
                paused: true,
            },
            wire::Method::SmithsDelete { id: id() },
            wire::Method::SmithsAcceptIdentity { id: id() },
            wire::Method::SmithsRevertIdentity { id: id() },
            wire::Method::ChannelsCreate {
                project: "demo".into(),
                name: "design".into(),
            },
            wire::Method::ChannelsRename {
                id: id(),
                name: "ux".into(),
            },
            wire::Method::ChannelsDelete { id: id() },
            wire::Method::ChannelsAddMember {
                id: id(),
                smith_id: id(),
            },
            wire::Method::ChannelsRemoveMember {
                id: id(),
                smith_id: id(),
            },
            wire::Method::KeepersDismiss {
                task_id: id(),
                finding_id: id(),
                reason: None,
            },
            wire::Method::KeepersAcceptReply {
                task_id: id(),
                finding_id: id(),
            },
            wire::Method::KeepersDecide {
                task_id: id(),
                keeper_id: id(),
                decision: wire::KeeperDecision::Accept,
                rounds: None,
                note: None,
            },
            wire::Method::KeepersSetSwitch {
                task_id: id(),
                keeper_id: id(),
                on: false,
            },
            wire::Method::KeepersCheckReady { task_id: id() },
            wire::Method::KeepersSendFindings {
                task_id: id(),
                keeper_id: id(),
            },
        ] {
            assert!(method_is_user_only(&method), "{method:?}");
            assert!(method_is_mutation(&method), "{method:?}");
        }
        for method in [
            wire::Method::SmithsList {},
            wire::Method::SmithsGet { id: id() },
            wire::Method::ChannelsList {
                project: None,
                task_id: None,
            },
            wire::Method::KeepersState { task_id: id() },
        ] {
            assert!(!method_is_user_only(&method), "{method:?}");
            assert!(method_runs_concurrently(&method), "{method:?}");
        }
    }

    #[test]
    fn a_tracker_pull_does_not_hold_up_the_local_backlog() {
        let import = wire::Method::WorkItemImportExternal {
            project: "demo".into(),
            provider: None,
        };
        assert!(method_runs_concurrently(&import));
        assert!(method_runs_concurrently(&wire::Method::TrackerStatus {}));
    }
}
