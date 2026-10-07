use anyhow::Result;
use tokio::sync::oneshot;

use warpforge_protocol as wire;

use crate::registry::ProjectEntry;

use crate::daemon::actor::{ChildResult, GitEffect, ProjectRemovalError};
use crate::daemon::task::{Task, TaskStatus};

/// What a probe needs to spawn an agent: the ACP command, a representative cwd
/// and the account environment a real session would get.
#[derive(Debug, Clone)]
pub struct AgentProbeContext {
    pub acp_command: String,
    pub cwd: std::path::PathBuf,
    pub env: crate::daemon::accounts::AgentEnv,
}

pub enum Command {
    Projects(oneshot::Sender<Vec<ProjectEntry>>),
    Tasks(oneshot::Sender<Vec<Task>>),
    /// Full serializable state snapshot (sent to a client on `state.subscribe`).
    Snapshot(oneshot::Sender<wire::Snapshot>),
    /// Start every declared service + port-forward for a project (what "opening"
    /// a project used to do implicitly in the TUI — now explicit).
    OpenProject {
        name: String,
    },
    StartService {
        project: String,
        service: String,
    },
    StopService {
        project: String,
        service: String,
    },
    RestartService {
        project: String,
        service: String,
    },
    /// Start every declared service for a project (services only, no port-forwards).
    StartAllServices {
        project: String,
    },
    StopProject {
        project: String,
    },
    /// Atomically check whether an update can interrupt this daemon. If no
    /// blockers exist, the actor tears down and acknowledges only afterward;
    /// commands queued behind this one are never allowed to start new work.
    UpdateSafety {
        reply: oneshot::Sender<Vec<String>>,
    },
    /// What a quit would stop: like [`Command::UpdateSafety`] but it also
    /// counts services and port-forwards that are already running, not only
    /// those still starting. Read-only; the actor keeps running.
    QuitCheck {
        reply: oneshot::Sender<Vec<String>>,
    },
    /// Stop every service and port-forward while keeping the daemon and agent
    /// sessions alive. Used when the desktop UI closes.
    StopRuntime,
    /// A window of a service's retained log lines (events only carry the tail).
    /// The reply is (lines, capture-timestamps[ms], nextSeq cursor).
    ServiceLogs {
        project: String,
        service: String,
        after: u64,
        limit: Option<u32>,
        reply: oneshot::Sender<(Vec<String>, Vec<u64>, u64)>,
    },
    /// A window of a port-forward's retained log lines.
    PortForwardLogs {
        project: String,
        name: String,
        after: u64,
        limit: Option<u32>,
        reply: oneshot::Sender<(Vec<String>, Vec<u64>, u64)>,
    },
    /// Start every declared port-forward for a project (port-forwards only).
    StartAllPortForwards {
        project: String,
    },
    /// Start a single declared port-forward by its label.
    StartPortForward {
        project: String,
        name: String,
    },
    StopPortForward {
        project: String,
        name: String,
    },
    StopAllPortForwards {
        project: String,
    },
    SpawnAgent {
        project: String,
        command: String,
        description: String,
        cols: u16,
        rows: u16,
        /// Task the terminal belongs to, when opened from a task's Terminal tab.
        /// Its worktree becomes the terminal's cwd when it exists on disk.
        task_id: Option<String>,
        reply: oneshot::Sender<Result<String>>,
    },
    WriteAgent {
        id: String,
        data: Vec<u8>,
    },
    ResizeAgent {
        id: String,
        cols: u16,
        rows: u16,
    },
    KillAgent {
        id: String,
    },
    /// A task's worktree checkout finished (or failed); start its session.
    WorktreeReady {
        task_id: String,
        created: Result<crate::daemon::actor::session::WorktreeCreated, String>,
    },
    /// Test-only: report whether a finished turn's output has a consumer.
    #[cfg(test)]
    TurnOutputConsumerProbe {
        task_id: String,
        workflow_child: bool,
        reply: oneshot::Sender<bool>,
    },
    /// A worktree merge finished with removal requested; stop the task's
    /// terminals and session, remove its checkout, mark it Done, and reply.
    WorktreeMerged {
        task_id: String,
        message: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    /// Test-only: replace the worktree remover so a test can hold a removal
    /// open and prove the actor does not await it.
    #[cfg(test)]
    SetWorktreeRemover {
        remover: crate::daemon::worktree::RemoveFn,
    },
    /// A git operation that ran off the loop finished; apply what it changed
    /// to the task's state.
    GitOpFinished {
        task_id: String,
        effect: GitEffect,
    },
    /// A task's resume replay guard was read from the store; start its session
    /// now that replayed history can be de-duplicated. Loaded off the loop
    /// (write-behind flush + store read), mirroring [`Command::WorktreeReady`].
    ResumeReplayReady {
        task_id: String,
        replay: std::collections::VecDeque<wire::SessionUpdate>,
    },
    /// A finished turn's full text output was assembled from the store; deliver
    /// it to the orchestrator / parent inbox off the actor loop.
    TaskOutputReady {
        task_id: String,
        success: bool,
        workflow_child: bool,
        /// Who asked for the turn this output belongs to. A scheduled run is
        /// only closed out by its own turn, never by a person's follow-up that
        /// happened to land in the same session.
        initiator: crate::daemon::acp::TurnInitiator,
        output: String,
    },
    CreateTask {
        project: String,
        prompt: String,
        agent: String,
        tags: Vec<String>,
        include_runtime_context: bool,
        /// When true, create an isolated git worktree for this task.
        worktree: bool,
        /// Where that worktree starts; ignored unless `worktree`.
        worktree_base: crate::daemon::worktree::StartPoint,
        /// Set when this task is a sub-agent of an orchestrator task.
        parent_task_id: Option<String>,
        attachments: Vec<wire::PromptAttachment>,
        /// Model id to apply to the agent session before the first prompt
        /// (via `session/set_config_option`). When None, the daemon falls back
        /// to the agent's `last_model` so orchestrator-spawned sub-agents
        /// inherit the user's previous pick without an explicit UI selection.
        default_model: Option<String>,
        /// Non-model config overrides (reasoning effort, mode, etc.) keyed by
        /// config-option id; applied via `session/setConfigOption` after model.
        config_overrides: std::collections::HashMap<String, String>,
        /// Id of the backlog item this task was started from, if any.
        backlog_item_id: Option<String>,
        /// What created this task, when it is not the board (`pr-review`).
        origin: Option<String>,
        /// When false, create the task but do not start its agent session.
        start: bool,
        /// The agent this task may consult through `ask_advisor`.
        advisor: Option<wire::AdvisorPick>,
        reply: oneshot::Sender<String>,
    },
    /// Create a workflow-pipeline parent task and start its first stage.
    /// Unlike `CreateTask` the parent gets no agent session of its own — the
    /// daemon drives stages as child tasks.
    CreateWorkflowTask {
        project: String,
        prompt: String,
        agent: String,
        tags: Vec<String>,
        worktree: bool,
        worktree_base: crate::daemon::worktree::StartPoint,
        workflow: String,
        attachments: Vec<wire::PromptAttachment>,
        default_model: Option<String>,
        include_runtime_context: bool,
        config_overrides: std::collections::HashMap<String, String>,
        /// Set when this pipeline is a sub-agent of an orchestrator task —
        /// its final outcome is delivered to that task's inbox.
        parent_task_id: Option<String>,
        /// The backlog item the pipeline was started from; set on the parent.
        backlog_item_id: Option<String>,
        reply: oneshot::Sender<Result<String, String>>,
    },
    /// Soft-pause a workflow pipeline at its next stage barrier.
    WorkflowPause {
        task: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Resume a paused workflow pipeline.
    WorkflowResume {
        task: String,
        note: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Answer a workflow stage's pending `need_user_input` question.
    WorkflowReply {
        task: String,
        message: String,
        /// Barrier the answer was written against; a mismatch is refused.
        barrier_id: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Decide what an out-of-rounds workflow pipeline does next.
    WorkflowDecide {
        task: String,
        decision: wire::WorkflowDecision,
        rounds: Option<u32>,
        note: Option<String>,
        /// Barrier the decision was made against; a mismatch is refused.
        barrier_id: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// A verify stage took a browser screenshot: reserve an evidence file for
    /// it. Replies `None` when the task is not a running verify stage.
    WorkflowKeepEvidence {
        task_id: String,
        mime: String,
        reply: oneshot::Sender<Option<(String, String)>>,
    },
    /// `advisor.ask`: open a consultation with the task's advisor. The reply
    /// is a refusal, or a ticket that yields the answer (ADR 0022).
    AdvisorAsk {
        task_id: String,
        question: String,
        context: Option<String>,
        reply: oneshot::Sender<Result<crate::daemon::actor::advisor::AdvisorTicket, String>>,
    },
    /// `html.render`: add a stored page to the task's transcript. Fails for a
    /// task that does not exist.
    HtmlRenderPublish {
        task_id: String,
        render_id: String,
        title: String,
        height: u32,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// `advisor.wait`: keep waiting for the pending consultation's answer.
    AdvisorWait {
        task_id: String,
        reply: oneshot::Sender<Result<crate::daemon::actor::advisor::AdvisorTicket, String>>,
    },
    /// The transcript digest for a consultation was read off the loop.
    AdvisorContextReady {
        executor: String,
        consultation: u64,
        digest: crate::daemon::actor::advisor::prompt::Digest,
    },
    /// The advisor's session refused the consultation's prompt.
    AdvisorUndelivered {
        executor: String,
        consultation: u64,
        error: String,
    },
    /// A consultation reached its deadline without an answer.
    AdvisorDeadline {
        executor: String,
        consultation: u64,
    },
    /// Drain an orchestrator task's inbox of finished sub-agent results.
    ReadInbox {
        parent_task_id: String,
        reply: oneshot::Sender<Vec<ChildResult>>,
    },
    CancelTask {
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Archive a task (set status to Done, hide from live views).
    ArchiveTask {
        id: String,
    },
    /// Read one task's full folded conversation history (off the loop).
    SessionHistory {
        task_id: String,
        reply: oneshot::Sender<Result<Vec<wire::SessionUpdate>, String>>,
    },
    /// Read the task-history retention setting from config.yaml.
    HistoryGetSettings {
        reply: oneshot::Sender<wire::HistorySettings>,
    },
    /// Change the retention windows, persist them, and sweep immediately.
    HistorySetSettings {
        retention_days: u32,
        settle_ignored_after_days: u32,
        delete_closed_after_days: u32,
        reply: oneshot::Sender<Result<wire::HistorySettings, String>>,
    },
    /// Prune finished tasks' transcripts older than the retention window.
    /// Fired at daemon start, daily, and after a settings change.
    PruneHistory,
    /// Delete a task and its session history permanently.
    DeleteTask {
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Bulk-delete every settled task, scoped to `project` when given. Drives
    /// each survivor through the same `DeleteTask` path one at a time.
    DeleteSettledTasks {
        project: Option<String>,
        reply: oneshot::Sender<wire::DeleteSettledResult>,
    },
    /// Override a task's title, persist, and emit TaskUpdated.
    SetTaskTitle {
        id: String,
        title: String,
    },
    /// Merge a task's worktree branch back into its base branch. When
    /// `remove_worktree` is true, remove the checkout and delete the branch
    /// after a successful merge.
    MergeWorktree {
        task_id: String,
        remove_worktree: bool,
        reply: oneshot::Sender<Result<String, String>>,
    },
    /// Stop a task's terminals and session, then remove its worktree and
    /// local branch. The task record is kept, pointed at no checkout.
    DiscardWorktree {
        task_id: String,
    },
    /// List active worktrees for a project.
    ListWorktrees {
        project: String,
        reply: oneshot::Sender<Vec<wire::WorktreeInfo>>,
    },
    /// Settle a task (user acknowledged, hide from attention).
    SettleTask {
        task_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Clear the settled state on a task.
    UnsettleTask {
        task_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Snooze a task until the given Unix timestamp.
    SnoozeTask {
        task_id: String,
        until: u64,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Clear the snooze state on a task.
    UnsnoozeTask {
        task_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// List resumable agent sessions found on disk for a project's cwd.
    ListSessions {
        project: String,
        reply: oneshot::Sender<Vec<wire::ExternalSession>>,
    },
    /// Resume an external agent session as a new task; replies with its task id.
    ResumeTask {
        project: String,
        agent: String,
        session_id: String,
        title: String,
        reply: oneshot::Sender<String>,
    },
    /// Compute the task's working-tree diff (git).
    GetDiff {
        task_id: String,
        include_ignored: bool,
        reply: oneshot::Sender<wire::TaskDiff>,
    },
    /// Old (HEAD) + new (working-tree) text of one file.
    GetFileContents {
        task_id: String,
        path: String,
        project: Option<String>,
        reply: oneshot::Sender<Option<wire::FileDoc>>,
    },
    /// List files in a task's project working tree.
    ListFiles {
        task_id: String,
        project: Option<String>,
        include_ignored: bool,
        reply: oneshot::Sender<Vec<wire::ProjectFile>>,
    },
    /// Write new contents to a file in the task's working tree.
    SaveFile {
        task_id: String,
        path: String,
        content: String,
        project: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    CreateFile {
        task_id: String,
        path: String,
        directory: bool,
        project: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    RenameFile {
        task_id: String,
        path: String,
        new_path: String,
        project: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    DeleteFile {
        task_id: String,
        path: String,
        project: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Plain-text search across the task's project working tree.
    SearchFiles {
        task_id: String,
        query: String,
        limit: u32,
        project: Option<String>,
        reply: oneshot::Sender<Vec<wire::SymbolMatch>>,
    },
    /// Accept (keep) or reject (revert) a single hunk in the working tree.
    ResolveHunk {
        task_id: String,
        file: String,
        hunk_index: u32,
        resolution: wire::HunkResolution,
    },
    /// Stage (optionally a subset of) files and commit them in the task's repo.
    GitCommit {
        task_id: String,
        message: String,
        files: Option<Vec<String>>,
        amend: bool,
        project: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Read the task repo's latest commit message (for pre-filling an amend).
    GitLastCommitMessage {
        task_id: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    /// Fetch + rebase the task's repo onto its upstream (autostash, rollback).
    GitUpdate {
        task_id: String,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    /// List local branches of a repo, located by task or by project name.
    GitBranches {
        task_id: Option<String>,
        project: Option<String>,
        reply: oneshot::Sender<wire::GitBranchList>,
    },
    /// List this repo's root plus any nested git checkouts under it.
    GitRoots {
        task_id: Option<String>,
        project: Option<String>,
        reply: oneshot::Sender<wire::GitRoots>,
    },
    /// `git add` paths without committing (unversioned → tracked).
    GitAdd {
        task_id: String,
        paths: Vec<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Append paths to the repo's root `.gitignore`.
    GitIgnorePaths {
        task_id: String,
        paths: Vec<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// List the task repo's shelf bundles, newest first.
    ShelfList {
        task_id: String,
        reply: oneshot::Sender<wire::ShelfList>,
    },
    /// Shelve paths (or every change) and revert the worktree.
    ShelfCreate {
        task_id: String,
        name: String,
        paths: Option<Vec<String>>,
        reply: oneshot::Sender<Result<wire::ShelfEntry, String>>,
    },
    /// One shelf bundle with its files as diffs.
    ShelfGet {
        task_id: String,
        id: String,
        reply: oneshot::Sender<Result<wire::ShelfDiff, String>>,
    },
    /// Unshelve a bundle back into the worktree.
    ShelfApply {
        task_id: String,
        id: String,
        drop: bool,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Delete a shelf bundle.
    ShelfDrop {
        task_id: String,
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// List the task repo's stash entries, newest first.
    StashList {
        task_id: String,
        reply: oneshot::Sender<wire::StashList>,
    },
    /// Stash paths (or everything) with `git stash push`.
    StashPush {
        task_id: String,
        message: String,
        paths: Option<Vec<String>>,
        reply: oneshot::Sender<Result<wire::StashEntry, String>>,
    },
    /// One stash entry with its files as diffs.
    StashGet {
        task_id: String,
        id: String,
        reply: oneshot::Sender<Result<wire::StashDiff, String>>,
    },
    /// Apply or pop a whole stash entry.
    StashApply {
        task_id: String,
        id: String,
        pop: bool,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Restore paths out of a stash entry into the worktree.
    StashFile {
        task_id: String,
        id: String,
        paths: Vec<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Drop a stash entry.
    StashDrop {
        task_id: String,
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// List this repo's `.gitignore`'d paths (the "Show Ignored Files"
    /// toggle), without recomputing the full working-tree diff.
    GitIgnored {
        task_id: Option<String>,
        project: Option<String>,
        reply: oneshot::Sender<wire::GitIgnoredFiles>,
    },
    /// Switch the task's repo to `branch` (smart checkout, rollback on conflict).
    GitSwitchBranch {
        task_id: String,
        branch: String,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    /// Rename a local branch.
    GitBranchRename {
        task_id: String,
        branch: String,
        new_name: String,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    /// Delete a local branch.
    GitBranchDelete {
        task_id: String,
        branch: String,
        force: bool,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    /// Create a branch from a ref and check it out.
    GitBranchCreate {
        task_id: String,
        name: String,
        from: Option<String>,
        checkout: bool,
        overwrite: bool,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    /// Rebase the current branch onto `target`.
    GitRebase {
        task_id: String,
        branch: String,
        target: String,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    /// Merge `target` into the current branch.
    GitMerge {
        task_id: String,
        target: String,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    GitPushInfo {
        task_id: String,
        reply: oneshot::Sender<Result<wire::GitPushInfo, String>>,
    },
    GitPush {
        task_id: String,
        force: bool,
        reply: oneshot::Sender<wire::GitOpResult>,
    },
    GitCreatePr {
        task_id: String,
        title: String,
        body: String,
        base: Option<String>,
        reply: oneshot::Sender<Result<String, String>>,
    },
    GenerateText {
        task_id: String,
        agent_id: String,
        kind: wire::TextGenKind,
        model: Option<String>,
        /// Account to run against; `None` uses the agent's active one.
        account_id: Option<String>,
        /// Client-supplied text for kinds that summarise the conversation.
        input: Option<String>,
        reply: oneshot::Sender<Result<String, String>>,
    },
    EnhanceText {
        project: String,
        agent_id: String,
        prompt: String,
        model: Option<String>,
        reply: oneshot::Sender<Result<String, String>>,
    },
    TrackerPersistLink {
        link: crate::daemon::store::TrackerLink,
        reply: oneshot::Sender<Result<(), String>>,
    },
    TrackerLinks {
        reply: oneshot::Sender<Result<Vec<wire::TrackerLinkInfo>, String>>,
    },
    TrackerProjectSettings {
        project: String,
        reply: oneshot::Sender<Result<wire::TrackerProjectSettings, String>>,
    },
    TrackerSetProjectLinearTeam {
        project: String,
        team_id: Option<String>,
        team_name: Option<String>,
        reply: oneshot::Sender<Result<wire::TrackerProjectSettings, String>>,
    },
    TrackerSyncInputs {
        ids: Vec<String>,
        /// Links, each github project's repo dir, each linear project's team id.
        #[allow(clippy::type_complexity)]
        reply: oneshot::Sender<(
            Vec<crate::daemon::store::TrackerLink>,
            std::collections::HashMap<String, String>,
            std::collections::HashMap<String, String>,
        )>,
    },
    TrackerPersistSynced {
        links: Vec<crate::daemon::store::TrackerLink>,
        reply: oneshot::Sender<()>,
    },
    TrackerDeleteItems {
        ids: Vec<String>,
        reply: oneshot::Sender<()>,
    },
    TrackerAdoptImported {
        project: String,
        fetched: Vec<(String, Vec<crate::daemon::tracker::RemoteIssue>)>,
        #[allow(clippy::type_complexity)]
        reply: oneshot::Sender<
            Result<(Vec<wire::ImportedWorkItem>, Vec<wire::SyncedExternalItem>), String>,
        >,
    },
    BacklogGetSettings {
        reply: oneshot::Sender<Result<wire::BacklogSettings, String>>,
    },
    BacklogSetStorage {
        mode: wire::BacklogStorageMode,
        reply: oneshot::Sender<Result<wire::BacklogSettings, String>>,
    },
    BacklogList {
        project: String,
        query: crate::daemon::backlog::Query,
        reply: oneshot::Sender<Result<wire::BacklogPage, String>>,
    },
    BacklogCreate {
        item: crate::daemon::backlog::NewItem,
        reply: oneshot::Sender<Result<wire::BacklogItem, String>>,
    },
    BacklogUpdate {
        patch: crate::daemon::backlog::ItemPatch,
        reply: oneshot::Sender<Result<wire::BacklogItem, String>>,
    },
    BacklogAttachExternal {
        item_id: String,
        project: String,
        provider: String,
        external_id: String,
        url: String,
        remote_status: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    BacklogDelete {
        item_id: String,
        project: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    WorkItemLinkTask {
        item_id: String,
        task_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Send a follow-up prompt into a task's running agent session.
    SessionPrompt {
        task_id: String,
        text: String,
        attachments: Vec<wire::PromptAttachment>,
        initiator: crate::daemon::acp::TurnInitiator,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Force-send: end the running turn and deliver the session's queued
    /// messages now, merged into one turn, instead of one per turn after it.
    SessionInterrupt {
        task_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Drop one message that is still waiting in a session's queue.
    SessionRemoveQueued {
        task_id: String,
        queued_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Replace the text of one message that is still waiting in a session's
    /// queue, keeping its attachments.
    SessionEditQueued {
        task_id: String,
        queued_id: String,
        text: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Answer a permission request the agent raised.
    SessionPermission {
        task_id: String,
        request_id: String,
        outcome: String,
        /// `Ok` when this answer won; `Err` when the request was already
        /// answered (first-writer-wins), carrying the outcome that won.
        reply: oneshot::Sender<Result<(), crate::daemon::actor::lifecycle::PermissionAnswerError>>,
    },
    /// Raise a permission prompt of the daemon's own on a task's chat.
    AskUser {
        task_id: String,
        title: String,
        browser_origin: Option<String>,
        reply: oneshot::Sender<Result<crate::daemon::actor::user_ask::UserAsk, String>>,
    },
    /// Withdraw an unanswered `AskUser` prompt.
    WithdrawAsk {
        task_id: String,
        request_id: String,
    },
    /// Change a session selector (model/mode/…) the agent exposes. The reply
    /// carries the agent's verdict so the UI can undo a rejected pick.
    SessionSetConfigOption {
        task_id: String,
        config_id: String,
        value: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// The verdict of a `SessionSetConfigOption` round-trip, routed back so
    /// the actor (which owns task state) can record it: an accepted model
    /// selector change is the task's model intent; a rejected one is a
    /// durable `ModelMismatch`.
    SessionConfigOptionResult {
        task_id: String,
        config_id: String,
        value: String,
        result: Result<(), String>,
    },
    /// Detect installed ACP-capable agents (runs which/where, returns list).
    DetectAgents {
        reply: oneshot::Sender<Vec<wire::DetectedAgent>>,
    },
    /// Save agent configuration from setup wizard or settings.
    UpdateAgents {
        agents: Vec<wire::AgentConfig>,
    },
    /// Every registered agent account.
    ListAccounts {
        reply: oneshot::Sender<Vec<wire::AccountInfo>>,
    },
    /// Register the agent's current login as a new account. Replies with the
    /// updated list, or the reason the import failed.
    ImportAccount {
        agent_id: String,
        label: String,
        reply: oneshot::Sender<Result<Vec<wire::AccountInfo>, String>>,
    },
    RenameAccount {
        account_id: String,
        label: String,
        reply: oneshot::Sender<Result<Vec<wire::AccountInfo>, String>>,
    },
    RemoveAccount {
        account_id: String,
        reply: oneshot::Sender<Result<Vec<wire::AccountInfo>, String>>,
    },
    SetActiveAccount {
        agent_id: String,
        account_id: String,
        reply: oneshot::Sender<Result<Vec<wire::AccountInfo>, String>>,
    },
    /// Trigger an ACP probe for one agent's model selectors. The probe runs in
    /// a background task and reports back via [`Command::AgentProbed`]. `reply`
    /// is set only for a user-requested refresh, which waits for the verdict.
    ProbeAgent {
        id: String,
        reply: Option<oneshot::Sender<Result<(), String>>>,
    },
    /// Resolve the command, cwd and account env a probe/session for an agent
    /// would spawn, so an install can verify the agent actually starts.
    AgentProbeContext {
        id: String,
        reply: oneshot::Sender<Option<AgentProbeContext>>,
    },
    /// A probe finished — persist the discovered models and re-emit agents.
    /// Deliberately does not carry `last_model`: writing the pre-probe value
    /// back would revert an explicit pick made while the probe (up to ~15s)
    /// was in flight.
    AgentProbed {
        id: String,
        models: Vec<wire::ConfigOption>,
        /// The install generation the probe tested.
        generation: u64,
    },
    /// A probe failed. Sent for background probes too, which have no `reply`,
    /// so their failure still reaches agent-health tracking.
    AgentProbeFailed {
        id: String,
        error: String,
        /// The install generation the probe tested.
        generation: u64,
    },
    /// Detection finished off the actor loop: fill in the health held now,
    /// which a probe may have changed while detection ran.
    AgentsDetected {
        detected: Vec<wire::DetectedAgent>,
        reply: oneshot::Sender<Vec<wire::DetectedAgent>>,
    },
    /// Record a probe/install-verify outcome for an agent's tracked health,
    /// outside the `ProbeAgent` flow — used after a manual install's own
    /// verification, so a fixed agent does not keep showing an earlier mark.
    ObserveAgentHealth {
        id: String,
        result: Result<(), String>,
    },
    /// Start an orchestration plan (planner→worker→reviewer pipeline).
    StartOrchestration {
        project: String,
        goal: String,
        reply: oneshot::Sender<(String, String)>,
    },
    /// List active orchestration graphs.
    ListOrchestrations {
        reply: oneshot::Sender<Vec<crate::orchestration::GraphInfo>>,
    },
    /// Get the orchestrator configuration.
    GetOrchestratorConfig {
        reply: oneshot::Sender<wire::OrchestratorConfigDto>,
    },
    /// Save the orchestrator configuration.
    SaveOrchestratorConfig {
        config: wire::OrchestratorConfigDto,
        reply: oneshot::Sender<bool>,
    },
    /// Force-set a task's status and emit a TaskUpdated event. Used by the
    /// orchestrator to reflect aggregate orchestration state on the parent task.
    SetTaskStatus {
        id: String,
        status: TaskStatus,
    },
    /// Add a project to the registry, generate config if needed, broadcast update.
    AddProject {
        path: String,
        name: Option<String>,
        /// Optional sticky port range assigned at registration, like the
        /// CLI's `warpforge add --ports`. Not a local override — a declared
        /// config range outranks it (ADR 0006).
        port_range: Option<crate::registry::PortRange>,
        reply: oneshot::Sender<Result<ProjectEntry, String>>,
    },
    /// Remove a project from the registry and broadcast the update.
    RemoveProject {
        name: String,
        stop_resources: bool,
        reply: oneshot::Sender<Result<(), ProjectRemovalError>>,
    },
    /// Set (or clear) a project's local port-range override, re-resolve every
    /// range, and broadcast the affected projects. Local registry only — the
    /// shared config is never touched (ADR 0006 invariant 1).
    SetPortRange {
        project: String,
        /// `None` clears the override.
        range: Option<crate::registry::PortRange>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Ensure a language server is running for a task's workspace + language.
    LspStart {
        task_id: String,
        language: String,
        project: Option<String>,
        reply: oneshot::Sender<wire::LspStartResult>,
    },
    /// Forward an opaque LSP message to a running server's stdin.
    LspSend {
        server_id: String,
        payload: serde_json::Value,
    },
    /// Release one editor's reference to a language server.
    LspStop {
        server_id: String,
    },
    /// Persist a durable fact into shared memory.
    MemoryStore {
        content: String,
        scope: Option<String>,
        kind: Option<String>,
        tags: Option<Vec<String>>,
        project_id: Option<String>,
        created_by: Option<String>,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    /// Full-text search over shared memories.
    MemorySearch {
        query: String,
        scope: Option<String>,
        limit: Option<u32>,
        mode: Option<String>,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryList {
        scope: Option<String>,
        kind: Option<String>,
        limit: Option<u32>,
        offset: Option<u32>,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryUpdate {
        id: String,
        content: String,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryDelete {
        id: String,
        reply: oneshot::Sender<Result<(), crate::daemon::memory::MemoryError>>,
    },
    MemoryStats {
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    SetMemoryEmbedding {
        mode: String,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryAddEdge {
        src_id: String,
        dst_id: String,
        relation: String,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryEdges {
        id: String,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryDream {
        dry_run: bool,
        project_id: Option<String>,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryListCompaction {
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    MemoryResolveCompaction {
        id: i64,
        approve: bool,
        apply: bool,
        reply: oneshot::Sender<Result<serde_json::Value, crate::daemon::memory::MemoryError>>,
    },
    Shutdown {
        reply: oneshot::Sender<()>,
    },
    /// Every automation, optionally narrowed to one project name.
    AutomationList {
        project: Option<String>,
        reply: oneshot::Sender<Result<Vec<wire::Automation>, String>>,
    },
    /// One automation by id.
    AutomationShow {
        id: String,
        reply: oneshot::Sender<Result<wire::Automation, String>>,
    },
    /// Persist a fully-built automation (the caller validated the schedule).
    AutomationCreate {
        automation: Box<wire::Automation>,
        reply: oneshot::Sender<Result<wire::Automation, String>>,
    },
    /// Patch an automation; absent patch fields are left alone.
    AutomationUpdate {
        id: String,
        patch: Box<wire::AutomationPatch>,
        reply: oneshot::Sender<Result<wire::Automation, String>>,
    },
    /// Delete an automation and its run history.
    AutomationDelete {
        id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// Run an automation immediately: skips precheck and grace, refuses to
    /// overlap a live run, does not move the next scheduled occurrence.
    AutomationRunNow {
        id: String,
        reply: oneshot::Sender<Result<wire::AutomationRun, String>>,
    },
    /// Run history for one automation, newest first.
    AutomationRuns {
        id: String,
        limit: Option<u32>,
        reply: oneshot::Sender<Result<Vec<wire::AutomationRun>, String>>,
    },
    /// Periodic scheduler tick: fire due automations, advance next_run_at.
    AutomationTick,
    /// A dispatched run got its task (or failed to): link the task into the run
    /// row and the automation's last-run columns.
    AutomationRunLinked {
        automation: Box<wire::Automation>,
        run_id: String,
        reused: bool,
        result: Result<String, String>,
    },
    /// A run's precheck finished off the loop. `ok == false` skips the run.
    AutomationPrecheckDone {
        automation: Box<wire::Automation>,
        run_id: String,
        trigger: wire::AutomationRunTrigger,
        ok: bool,
        detail: Option<String>,
    },
    ListAgentLimits {
        reply: oneshot::Sender<Vec<wire::AgentAccountLimits>>,
        refresh: bool,
    },
    /// Quota gate for a new run of `agent` on its active account.
    DispatchRefusal {
        agent: String,
        reply: oneshot::Sender<Option<String>>,
    },
    ListAgentSpend {
        reply: oneshot::Sender<Vec<wire::AgentSpend>>,
    },
    AgentSpendUpdated {
        agents: Vec<wire::AgentSpend>,
        at: std::time::Instant,
    },
    AgentLimitsUpdated {
        accounts: Vec<wire::AgentAccountLimits>,
    },
    /// The backlog runner's commands, matched exhaustively in `actor/runner/`.
    Runner(crate::daemon::actor::runner::RunnerCommand),
}
