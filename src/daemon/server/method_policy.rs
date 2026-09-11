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
/// - Ordered work stays serial. LSP is a streaming protocol, so dispatching
///   `LspSend` concurrently would reorder a language server's inbox, and git
///   writes mean what they mean only in sequence: commit, then push.
pub(super) fn method_runs_concurrently(method: &wire::Method) -> bool {
    use wire::Method::*;
    matches!(
        method,
        TextGenerate { .. }
            | AgentsInstall { .. }
            | AgentsProbe { .. }
            | SessionSetConfigOption { .. }
            | LanguageServersInstall { .. }
            | DiffGet { .. }
            | FileContents { .. }
            | FileList { .. }
            | FileSearch { .. }
            | GitBranches { .. }
            | GitRoots { .. }
            | GitIgnored { .. }
            | GitPushInfo { .. }
            | GitLastCommitMessage { .. }
            | ServiceLogs { .. }
            | PortForwardLogs { .. }
            | RuntimeList { .. }
            | TaskListWorktrees { .. }
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
            | TrackerPullsList { .. }
            | TrackerPullDetails { .. }
            | TrackerPullDiff { .. }
            | TrackerPullCommits { .. }
            | TrackerPullThread { .. }
    )
}

pub(super) fn method_is_mutation(method: &wire::Method) -> bool {
    use wire::Method::*;
    !matches!(
        method,
        SystemHandshake { .. }
            | StateSubscribe { .. }
            | ServiceLogs { .. }
            | PortForwardLogs { .. }
            | RuntimeList { .. }
            | TaskListWorktrees { .. }
            | SessionsList { .. }
            | SessionHistory { .. }
            | HistoryGetSettings {}
            | OrchestratorListAgents { .. }
            | AgentsList {}
            | AccountsList {}
            | DiffGet { .. }
            | FileContents { .. }
            | FileList { .. }
            | FileSearch { .. }
            | GitBranches { .. }
            | GitRoots { .. }
            | GitIgnored { .. }
            | GitPushInfo { .. }
            | GitLastCommitMessage { .. }
            | OrchestrateList {}
            | OrchestrateGetConfig {}
            | WorkflowList { .. }
            | BootstrapFinalize { .. }
            | BootstrapReadConfig { .. }
            | WorkItemList { .. }
            | LspStart { .. }
            | LspSend { .. }
            | LspStop { .. }
            | LanguageServersDetect {}
            | AutomationList { .. }
            | AutomationShow { .. }
            | AutomationRuns { .. }
            | TrackerPullsList { .. }
            | TrackerPullDetails { .. }
            | TrackerPullDiff { .. }
            | TrackerPullCommits { .. }
            | TrackerPullThread { .. }
    )
}
