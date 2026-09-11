//! The `Method` enum: every client → daemon request and its params.
//!
//! This enum must stay exhaustive in one file; the payload types its variants
//! carry live in the topic modules beside this one.

use crate::{
    default_true, AgentConfig, AutomationPatch, AutomationTrigger, BacklogStorageMode,
    BootstrapAnswers, HunkResolution, OrchestratorConfigDto, PermissionOutcome, PromptAttachment,
    TextGenKind, WorkItemPriority, WorkflowDecision, DEFAULT_MISSED_RUN_GRACE_MINUTES,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_missed_run_grace_minutes() -> u32 {
    DEFAULT_MISSED_RUN_GRACE_MINUTES
}

fn default_search_limit() -> u32 {
    200
}

fn default_terminal_cols() -> u16 {
    80
}

fn default_terminal_rows() -> u16 {
    24
}

fn default_pull_state() -> String {
    "open".into()
}

fn default_pull_limit() -> u32 {
    50
}

fn default_review_side() -> String {
    "RIGHT".into()
}

fn default_page() -> u32 {
    0
}

fn default_page_size() -> u32 {
    20
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum Method {
    /// Negotiate the wire contract before a client enables mutations.
    #[serde(rename = "system.handshake")]
    SystemHandshake {
        client_version: String,
        protocol_version: u32,
    },
    /// Quiesce a desktop-owned daemon and shut it down for an atomic app
    /// update. Refused for externally started daemons or active work.
    #[serde(rename = "update.prepareShutdown")]
    UpdatePrepareShutdown {
        expected_daemon_version: String,
        protocol_version: u32,
    },

    /// Subscribe to state updates. Response is a [`Snapshot`]; events follow.
    #[serde(rename = "state.subscribe")]
    StateSubscribe {
        /// Empty = everything. Otherwise topic prefixes: "task", "service",
        /// "portforward", "agent", "project".
        #[serde(default)]
        topics: Vec<String>,
    },

    // ── Projects ──
    #[serde(rename = "project.add")]
    ProjectAdd {
        path: String,
        name: Option<String>,
        /// Optional sticky port range like `"4200-4299"`, assigned at
        /// registration (the same slot `warpforge add --ports` uses). A
        /// `ports.range` later declared in the project's config outranks it.
        /// Snake_case on the wire, like `stop_resources` — the enum's
        /// `rename_all` covers variant names, not fields.
        #[serde(default)]
        port_range: Option<String>,
    },
    #[serde(rename = "project.remove")]
    ProjectRemove {
        name: String,
        /// Explicitly authorize stopping live project resources before removal.
        /// Defaults to false so older clients fail safely when resources exist.
        #[serde(default)]
        stop_resources: bool,
    },
    /// Set (or clear, `range: null`) a project's local port-range override.
    /// Writes to the local registry only — never to the shared workspace
    /// config. The daemon re-resolves every project's range afterwards.
    #[serde(rename = "project.setPortRange")]
    ProjectSetPortRange {
        project: String,
        /// Inclusive range like `"4200-4299"`; `None` clears the override.
        range: Option<String>,
    },

    // ── Runtime lifecycle ──
    /// Stop all running dev services and port-forwards without shutting down
    /// the daemon or killing agent sessions.
    #[serde(rename = "runtime.stopAll")]
    RuntimeStopAll {},

    // ── Dev servers (existing ServiceManager behaviour, exposed) ──
    #[serde(rename = "service.start")]
    ServiceStart { project: String, service: String },
    #[serde(rename = "service.stop")]
    ServiceStop { project: String, service: String },
    #[serde(rename = "service.restart")]
    ServiceRestart { project: String, service: String },
    /// Start every service declared in the project's .warpforge.yaml
    /// (what the TUI did implicitly on "Enter project").
    #[serde(rename = "service.startAll")]
    ServiceStartAll { project: String },
    #[serde(rename = "service.stopAll")]
    ServiceStopAll { project: String },
    /// Fetch a window of retained log lines (events only carry the tail).
    #[serde(rename = "service.logs")]
    ServiceLogs {
        project: String,
        service: String,
        /// Return lines with seq > after. 0 = from the oldest retained line.
        #[serde(default)]
        after: u64,
        #[serde(default)]
        limit: Option<u32>,
    },

    // ── Port-forwards ──
    #[serde(rename = "portforward.startAll")]
    PortForwardStartAll { project: String },
    #[serde(rename = "portforward.start")]
    PortForwardStart { project: String, name: String },
    #[serde(rename = "portforward.stop")]
    PortForwardStop { project: String, name: String },
    #[serde(rename = "portforward.stopAll")]
    PortForwardStopAll { project: String },
    /// Fetch a window of retained port-forward log lines.
    #[serde(rename = "portforward.logs")]
    PortForwardLogs {
        project: String,
        name: String,
        #[serde(default)]
        after: u64,
        #[serde(default)]
        limit: Option<u32>,
    },
    /// List the project's declared services and port-forwards with their live
    /// status and allocated ports. Read-only; used by the MCP bridge so an agent
    /// can discover what runtime is up before reading logs or restarting a
    /// service.
    #[serde(rename = "runtime.list")]
    RuntimeList { project: String },

    // ── Tasks (agent sessions on the board) ──
    #[serde(rename = "task.create")]
    TaskCreate {
        project: String,
        /// Prompt / instruction handed to the agent.
        prompt: String,
        /// Agent template name from .warpforge.yaml, or a raw command.
        agent: String,
        #[serde(default)]
        tags: Vec<String>,
        /// When true (default), the daemon prepends a runtime-context block to
        /// the agent's first prompt describing the project's currently-running
        /// services and their live URLs/ports — so the agent knows the app is
        /// already up and can hit real endpoints / run tests against them.
        /// This is what ties Projects to agent work (see docs/UI_CONCEPT.md).
        #[serde(default = "default_true")]
        include_runtime_context: bool,
        /// When true, create an isolated git worktree for this task so it
        /// doesn't conflict with the main working tree or other tasks.
        #[serde(default)]
        worktree: bool,
        /// When set, this task is a sub-agent spawned by the given orchestrator
        /// task; its result is delivered back into that orchestrator's inbox.
        #[serde(default)]
        parent_task_id: Option<String>,
        /// Files and images included with the initial prompt.
        #[serde(default)]
        attachments: Vec<PromptAttachment>,
        /// Model id to apply to the agent session before the first prompt
        /// (via `session/setConfigOption`). When `None`, the daemon falls back
        /// to the agent's `last_model` so orchestrator-spawned sub-agents
        /// inherit the user's previous choice without an explicit UI pick.
        #[serde(default)]
        default_model: Option<String>,
        /// Non-model config overrides the user picked in the "New task" dialog
        /// (reasoning effort, mode, collaboration mode, fast mode, etc.).
        /// Keyed by config-option id; applied via `session/setConfigOption`
        /// after the model. Unknown option ids are logged and skipped.
        #[serde(default)]
        config_overrides: HashMap<String, String>,
        /// When set, run this task as a deterministic workflow pipeline: the
        /// created task becomes the pipeline parent (no agent session of its
        /// own) and the daemon drives plan? → implement → review ⇄ fix stages
        /// as child tasks. The id comes from `workflow.list`. Mutually
        /// exclusive with the orchestrator-chat mode.
        #[serde(default)]
        workflow: Option<String>,
        /// Id of the backlog item this task is started from, if any.
        #[serde(default)]
        backlog_item_id: Option<String>,
        /// What created this task, when it is not the board. `pr-review` marks
        /// the shadow task behind a pull request's Assistant tab: it belongs
        /// to that pane, and every board-shaped surface filters it out
        /// (docs/adr/0010). `None` = an ordinary task the user started.
        #[serde(default)]
        origin: Option<String>,
        /// When false, create without starting session. Defaults to true.
        #[serde(default = "default_true")]
        start: bool,
    },
    #[serde(rename = "task.cancel")]
    TaskCancel { task_id: String },
    /// Archive a finished task off the board.
    #[serde(rename = "task.archive")]
    TaskArchive { task_id: String },
    /// Delete a task and its persisted session history permanently.
    #[serde(rename = "task.delete")]
    TaskDelete { task_id: String },
    /// Bulk-delete every settled task (`status == "done"` or manually marked
    /// handled) — the shelf's "N done" clear-all action. Scoped to `project`
    /// when given, else every project. A settled task that still holds
    /// unmerged changes, is running, or has a pending permission request is
    /// skipped and counted as kept rather than deleted. Returns
    /// `DeleteSettledResult`.
    #[serde(rename = "task.deleteSettled")]
    TaskDeleteSettled {
        #[serde(default)]
        project: Option<String>,
    },
    /// Override a task's title (e.g. after async title generation completes).
    #[serde(rename = "task.setTitle")]
    TaskSetTitle { task_id: String, title: String },
    /// Merge a task's worktree branch back into its base branch and remove
    /// the worktree. No-op if the task has no worktree.
    #[serde(rename = "task.mergeWorktree")]
    TaskMergeWorktree { task_id: String },
    /// List active worktrees for a project.
    #[serde(rename = "task.listWorktrees")]
    TaskListWorktrees { project: String },

    // ── Lifecycle (settle/snooze visibility overlay) ──
    /// Mark a task as settled (user acknowledged, hide from attention).
    /// Rejected while the task is Running or has pending permission requests.
    #[serde(rename = "task.settle")]
    TaskSettle { task_id: String },
    /// Clear the settled state (make the task visible again).
    #[serde(rename = "task.unsettle")]
    TaskUnsettle { task_id: String },
    /// Snooze a task until the given Unix timestamp (hide from attention).
    /// Rejected while the task has pending permission requests. Running tasks
    /// may be snoozed.
    #[serde(rename = "task.snooze")]
    TaskSnooze { task_id: String, until: u64 },
    /// Clear the snooze state (make the task visible again).
    #[serde(rename = "task.unsnooze")]
    TaskUnsnooze { task_id: String },

    // ── External agent sessions (claude/codex on-disk session stores) ──
    /// List agent sessions found on disk for a project's working directory.
    /// Returns `{ sessions: ExternalSession[] }`.
    #[serde(rename = "sessions.list")]
    SessionsList { project: String },
    /// Resume an existing external agent session as a new warpforge task.
    /// Returns `{ taskId }`.
    #[serde(rename = "task.resume")]
    TaskResume {
        project: String,
        agent: String,
        session_id: String,
        #[serde(default)]
        title: String,
    },

    /// Drain an orchestrator task's inbox of finished sub-agent results.
    /// Returns `{ results: ChildResult[] }`. Called by the orchestrator's
    /// `read_inbox` MCP tool.
    #[serde(rename = "orchestrator.readInbox")]
    OrchestratorReadInbox { parent_task_id: String },
    /// List tasks spawned by an orchestrator. The parent id is required so an
    /// orchestrator cannot accidentally inspect another task's children.
    /// Returns `{ agents: TaskInfo[] }`; `project`, when supplied, narrows the
    /// result to that project as an additional safety filter.
    #[serde(rename = "orchestrator.listAgents")]
    OrchestratorListAgents {
        parent_task_id: String,
        #[serde(default)]
        project: Option<String>,
    },

    // ── Shared memory ──
    /// Persist a durable fact into shared memory. `scope` defaults to the
    /// current project when `project_id` is supplied, else `global`.
    #[serde(rename = "memory.store")]
    MemoryStore {
        content: String,
        #[serde(default)]
        scope: Option<String>,
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        tags: Option<Vec<String>>,
        #[serde(default)]
        project_id: Option<String>,
    },
    /// Full-text search over stored memories (FTS5, BM25-ranked).
    #[serde(rename = "memory.search")]
    MemorySearch {
        query: String,
        #[serde(default)]
        scope: Option<String>,
        #[serde(default)]
        limit: Option<u32>,
        #[serde(default)]
        mode: Option<String>,
    },
    #[serde(rename = "memory.list")]
    MemoryList {
        #[serde(default)]
        scope: Option<String>,
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        limit: Option<u32>,
        #[serde(default)]
        offset: Option<u32>,
    },
    #[serde(rename = "memory.update")]
    MemoryUpdate { id: String, content: String },
    #[serde(rename = "memory.delete")]
    MemoryDelete { id: String },
    #[serde(rename = "memory.stats")]
    MemoryStats {},
    /// Toggle local embeddings (`none` | `fastembed`). `fastembed` downloads
    /// all-MiniLM-L6-v2 (~80 MB) on first use; falls back to FTS when offline.
    #[serde(rename = "memory.setEmbedding")]
    MemorySetEmbedding { mode: String },
    #[serde(rename = "memory.addEdge")]
    MemoryAddEdge {
        src_id: String,
        dst_id: String,
        relation: String,
    },
    #[serde(rename = "memory.edges")]
    MemoryEdges { id: String },
    #[serde(rename = "memory.dream")]
    MemoryDream {
        #[serde(default)]
        dry_run: Option<bool>,
        #[serde(default)]
        project_id: Option<String>,
    },
    #[serde(rename = "memory.listCompaction")]
    MemoryListCompaction {},
    #[serde(rename = "memory.resolveCompaction")]
    MemoryResolveCompaction {
        id: i64,
        #[serde(default)]
        approve: Option<bool>,
    },

    // ── Agent registry ──
    /// Detect installed ACP-capable agents. Returns `{ detected: DetectedAgent[] }`.
    #[serde(rename = "agents.detect")]
    AgentsDetect {},
    /// Save the user's agent configuration (from setup wizard or settings).
    #[serde(rename = "agents.update")]
    AgentsUpdate { agents: Vec<AgentConfig> },
    /// Install or update an agent's global package (npm/brew). Runs the agent's
    /// install/update command and returns `{ ok, output }` when it finishes.
    #[serde(rename = "agents.install")]
    AgentsInstall { id: String },
    /// Re-read an agent's model/selector list from the harness, replacing the
    /// cached one. Use after adding a provider or model outside Warpforge.
    /// Resolves once the probe finishes; the refreshed list arrives as
    /// `agents.updated`.
    #[serde(rename = "agents.probe")]
    AgentsProbe { id: String },
    /// List configured agents with cached model options. Returns `{ agents: AgentConfig[] }`.
    #[serde(rename = "agents.list")]
    AgentsList {},

    // ── Agent accounts (several logins per agent, one active) ──
    /// All registered accounts. Returns `{ accounts: AccountInfo[] }`.
    #[serde(rename = "accounts.list")]
    AccountsList {},
    /// Register the agent's currently-authenticated login as a new account.
    /// Returns `{ accounts: AccountInfo[] }`.
    #[serde(rename = "accounts.import")]
    AccountsImport { agent_id: String, label: String },
    /// Rename an account. Returns `{ accounts: AccountInfo[] }`.
    #[serde(rename = "accounts.rename")]
    AccountsRename { account_id: String, label: String },
    /// Remove an account and delete its vault. Returns `{ accounts: AccountInfo[] }`.
    #[serde(rename = "accounts.remove")]
    AccountsRemove { account_id: String },
    /// Make an account the one new sessions use. Returns `{ accounts: AccountInfo[] }`.
    #[serde(rename = "listAgentLimits")]
    ListAgentLimits {
        #[serde(default)]
        refresh: Option<bool>,
    },
    #[serde(rename = "listAgentSpend")]
    ListAgentSpend {},

    #[serde(rename = "accounts.setActive")]
    AccountsSetActive {
        agent_id: String,
        account_id: String,
    },

    // ── ACP passthrough for a task's agent session ──
    /// Send a follow-up user message into a running session.
    #[serde(rename = "session.prompt")]
    SessionPrompt {
        task_id: String,
        text: String,
        #[serde(default)]
        attachments: Vec<PromptAttachment>,
    },
    /// Answer a permission request raised by the agent.
    #[serde(rename = "session.permission")]
    SessionPermission {
        task_id: String,
        request_id: String,
        outcome: PermissionOutcome,
    },
    /// Change a session selector (model/mode/…) the agent exposes.
    #[serde(rename = "session.setConfigOption")]
    SessionSetConfigOption {
        task_id: String,
        config_id: String,
        value: String,
    },

    // ── Diff / review ──
    #[serde(rename = "diff.get")]
    DiffGet {
        task_id: String,
        /// Also compute the .gitignore'd file list (the "Show Ignored Files"
        /// toggle) — skipped by default since most repos never need it.
        #[serde(default)]
        include_ignored: bool,
    },
    #[serde(rename = "diff.resolveHunk")]
    DiffResolveHunk {
        task_id: String,
        file: String,
        hunk_index: u32,
        resolution: HunkResolution,
    },
    /// Full old (HEAD) + new (working-tree) contents of one file — powers the
    /// editable side-by-side (CodeMirror merge) review.
    #[serde(rename = "file.contents")]
    FileContents {
        #[serde(default)]
        task_id: String,
        path: String,
        /// Read from the project's own checkout when no task owns the file
        /// (the project page's read-only Files surface).
        #[serde(default)]
        project: Option<String>,
    },
    /// List files in the task's project working tree.
    #[serde(rename = "file.list")]
    FileList {
        #[serde(default)]
        task_id: String,
        #[serde(default)]
        project: Option<String>,
        /// Include .gitignore'd paths (editor tree wants them; the composer's
        /// `@` picker does not — node_modules/target swamp it).
        #[serde(default)]
        include_ignored: bool,
    },
    /// Write new contents to a file in the task's working tree (in-review edit).
    #[serde(rename = "file.save")]
    FileSave {
        #[serde(default)]
        task_id: String,
        path: String,
        content: String,
        #[serde(default)]
        project: Option<String>,
    },
    #[serde(rename = "file.create")]
    FileCreate {
        task_id: String,
        path: String,
        #[serde(default)]
        directory: bool,
    },
    #[serde(rename = "file.rename")]
    FileRename {
        task_id: String,
        path: String,
        new_path: String,
    },
    #[serde(rename = "file.delete")]
    FileDelete { task_id: String, path: String },
    /// Plain-text search across the task's project working tree (grep). Powers
    /// "go to definition" (a symbol under the cursor resolved to its definition
    /// lines) and quick symbol lookup, without needing a full LSP server.
    #[serde(rename = "file.search")]
    FileSearch {
        task_id: String,
        /// Case-insensitive substring matched against each line.
        query: String,
        /// Cap on the number of matches returned (cheap safety valve).
        #[serde(default = "default_search_limit")]
        limit: u32,
        #[serde(default)]
        project: Option<String>,
    },
    /// Stage files and commit them in the task's repo. `files=None` stages all
    /// changes; `amend` rewrites the previous commit.
    #[serde(rename = "git.commit")]
    GitCommit {
        #[serde(default)]
        task_id: String,
        message: String,
        #[serde(default)]
        files: Option<Vec<String>>,
        #[serde(default)]
        amend: bool,
        #[serde(default)]
        project: Option<String>,
    },
    /// `git add` paths (the "Add to VCS" menu on unversioned files). Unlike
    /// `git.commit` this stages without committing, so the files move from
    /// "Unversioned Files" to "Changes" on the next `diff.get`.
    #[serde(rename = "git.add")]
    GitAdd { task_id: String, paths: Vec<String> },
    /// Append paths to the repo's root `.gitignore` (the "Add to .gitignore"
    /// menu on unversioned files). Lines already covered stay untouched —
    /// existing entries are never duplicated.
    #[serde(rename = "git.ignore")]
    GitIgnore { task_id: String, paths: Vec<String> },
    /// List the repo's shelf bundles (the Shelf tab), newest first.
    #[serde(rename = "shelf.list")]
    ShelfList { task_id: String },
    /// Shelve paths (or every change when `paths` is absent): store the
    /// bundle and revert the worktree. An empty `name` auto-names the bundle.
    #[serde(rename = "shelf.create")]
    ShelfCreate {
        task_id: String,
        #[serde(default)]
        name: String,
        #[serde(default)]
        paths: Option<Vec<String>>,
    },
    /// One shelf bundle with its files as diffs, for preview.
    #[serde(rename = "shelf.get")]
    ShelfGet { task_id: String, id: String },
    /// Unshelve a bundle back into the worktree. `drop` (default true)
    /// removes the bundle afterwards.
    #[serde(rename = "shelf.apply")]
    ShelfApply {
        task_id: String,
        id: String,
        #[serde(default = "default_true")]
        drop: bool,
    },
    /// Delete a shelf bundle. The worktree is untouched.
    #[serde(rename = "shelf.drop")]
    ShelfDrop { task_id: String, id: String },
    /// List the repo's stash entries (the Stash tab), newest first.
    #[serde(rename = "stash.list")]
    StashList { task_id: String },
    /// Stash paths (or everything when `paths` is absent) with
    /// `git stash push`. An empty `message` takes git's default.
    #[serde(rename = "stash.push")]
    StashPush {
        task_id: String,
        #[serde(default)]
        message: String,
        #[serde(default)]
        paths: Option<Vec<String>>,
    },
    /// One stash entry with its files as diffs, for preview.
    #[serde(rename = "stash.get")]
    StashGet { task_id: String, id: String },
    /// Apply (`pop=false`) or pop (`pop=true`) a whole stash entry. A
    /// conflicting pop keeps the entry — that is git's own behavior.
    #[serde(rename = "stash.apply")]
    StashApply {
        task_id: String,
        id: String,
        #[serde(default)]
        pop: bool,
    },
    /// Restore paths out of a stash entry into the worktree ("unstash any
    /// file"). The entry itself is untouched.
    #[serde(rename = "stash.file")]
    StashFile {
        task_id: String,
        id: String,
        paths: Vec<String>,
    },
    /// Drop a stash entry. The worktree is untouched.
    #[serde(rename = "stash.drop")]
    StashDrop { task_id: String, id: String },
    /// Pull the task's project repo up to its upstream (rebase + autostash).
    /// Any conflict rolls the working tree back to the exact prior state.
    #[serde(rename = "git.update")]
    GitUpdate { task_id: String },
    /// List local branches of a repo, identified either by a task or — before
    /// a task exists, as in New Task — by project name directly.
    #[serde(rename = "git.branches")]
    GitBranches {
        #[serde(default)]
        task_id: Option<String>,
        #[serde(default)]
        project: Option<String>,
    },
    /// List this repo's root plus any nested git repos under it (one entry
    /// each), with each root's current branch and configured remotes. A repo
    /// with no nested checkouts returns exactly one root.
    #[serde(rename = "git.roots")]
    GitRoots {
        #[serde(default)]
        task_id: Option<String>,
        #[serde(default)]
        project: Option<String>,
    },
    /// `.gitignore`'d paths of a repo, located by task or by project name.
    /// Separate from `diff.get` so the "Show Ignored Files" toggle costs one
    /// cheap `ls-files` instead of a full tracked+untracked recompute.
    #[serde(rename = "git.ignored")]
    GitIgnored {
        #[serde(default)]
        task_id: Option<String>,
        #[serde(default)]
        project: Option<String>,
    },
    /// Switch the task's project repo to `branch`, carrying uncommitted changes
    /// across (stash → checkout → unstash). A conflict rolls back to the branch
    /// you were on with your changes intact.
    #[serde(rename = "git.switchBranch")]
    GitSwitchBranch { task_id: String, branch: String },
    /// Rename a local branch to `new_name`. Works on the checked-out branch or
    /// any other; errors if `new_name` already exists.
    #[serde(rename = "git.branchRename")]
    GitBranchRename {
        task_id: String,
        branch: String,
        new_name: String,
    },
    /// Delete a local branch. Refuses the checked-out branch; without `force`
    /// also refuses unmerged branches.
    #[serde(rename = "git.branchDelete")]
    GitBranchDelete {
        task_id: String,
        branch: String,
        #[serde(default)]
        force: bool,
    },
    /// Create `name` from `from` (defaults to the current HEAD) and check it
    /// out, carrying uncommitted changes across.
    #[serde(rename = "git.branchCreate")]
    GitBranchCreate {
        task_id: String,
        name: String,
        #[serde(default)]
        from: Option<String>,
        #[serde(default = "default_true")]
        checkout: bool,
        #[serde(default)]
        overwrite: bool,
    },
    /// Rebase the current branch onto `target`, carrying uncommitted changes
    /// across. A conflict rolls back to the prior tree.
    #[serde(rename = "git.rebase")]
    GitRebase {
        task_id: String,
        branch: String,
        target: String,
    },
    /// Merge `target` into the current branch, carrying uncommitted changes.
    /// A conflict rolls back to the prior tree.
    #[serde(rename = "git.merge")]
    GitMerge { task_id: String, target: String },
    /// Describe the commits and files that would be sent by `git.push`.
    #[serde(rename = "git.pushInfo")]
    GitPushInfo { task_id: String },
    /// Full message of the task repo's latest commit, for pre-filling an amend.
    /// Returns `{ message }`, empty when the repo has no commits yet.
    #[serde(rename = "git.lastCommitMessage")]
    GitLastCommitMessage { task_id: String },
    /// Push the current branch. With `force`, uses `--force-with-lease`.
    #[serde(rename = "git.push")]
    GitPush {
        task_id: String,
        #[serde(default)]
        force: bool,
    },
    /// Open a GitHub pull request for the task branch via `gh`. Returns
    /// `{ url }`. `base` defaults to the repo's default branch when omitted.
    #[serde(rename = "git.createPr")]
    GitCreatePr {
        task_id: String,
        title: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        base: Option<String>,
    },
    /// Generate git prose (a commit message or a PR description) by running the
    /// configured text-generation agent one-shot over the task's diff. Returns
    /// `{ text }`. `model` overrides the agent's default when set.
    #[serde(rename = "text.generate")]
    TextGenerate {
        task_id: String,
        agent_id: String,
        kind: TextGenKind,
        #[serde(default)]
        model: Option<String>,
        /// Run against this account instead of the agent's active one. Lets a
        /// generation continue on a second account when the active one has hit
        /// a usage limit.
        #[serde(default)]
        account_id: Option<String>,
        /// Text to work from, for kinds that summarise the conversation rather
        /// than the repository. Required by `Handoff`: the client decides where
        /// the transcript is cut, since a fork continues from one message
        /// rather than from the end.
        #[serde(default)]
        input: Option<String>,
    },
    /// Polish a task prompt (title/description written by the user) using the
    /// configured text-generation agent one-shot. Returns `{ text }`. Unlike
    /// `text.generate` it does not need a task — the backlog creates locally and
    /// this runs before a task exists.
    #[serde(rename = "text.enhance")]
    TextEnhance {
        project: String,
        agent_id: String,
        prompt: String,
        #[serde(default)]
        model: Option<String>,
    },

    // ── Raw terminal agents (legacy PTY sessions, kept for the TUI) ──
    #[serde(rename = "terminal.spawn")]
    TerminalSpawn {
        project: String,
        command: String,
        #[serde(default = "default_terminal_cols")]
        cols: u16,
        #[serde(default = "default_terminal_rows")]
        rows: u16,
    },
    #[serde(rename = "terminal.input")]
    TerminalInput {
        terminal_id: String,
        /// Base64-encoded raw bytes for the PTY.
        data_b64: String,
    },
    #[serde(rename = "terminal.resize")]
    TerminalResize {
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "terminal.kill")]
    TerminalKill { terminal_id: String },

    // ── Orchestration ──
    /// Start an orchestration: planner → workers → reviewers pipeline.
    /// Returns `{ graphId, taskId }` — the taskId is the parent orchestrator task.
    #[serde(rename = "orchestrate.start")]
    OrchestrateStart { project: String, goal: String },
    /// List active orchestration graphs.
    #[serde(rename = "orchestrate.list")]
    OrchestrateList {},
    /// Cancel an orchestration and its child tasks.
    #[serde(rename = "orchestrate.cancel")]
    OrchestrateCancel { graph_id: String },
    /// Get the orchestrator configuration.
    #[serde(rename = "orchestrate.getConfig")]
    OrchestrateGetConfig {},
    /// Save the orchestrator configuration.
    #[serde(rename = "orchestrate.saveConfig")]
    OrchestrateSaveConfig { config: OrchestratorConfigDto },

    // ── Workflows (deterministic pipeline templates) ──
    /// List workflows selectable for a project: `.warpforge/workflows/*.yaml`
    /// plus built-in templates (a project file overrides the built-in with the
    /// same id). Returns `{ "workflows": [WorkflowMeta] }`.
    #[serde(rename = "workflow.list")]
    WorkflowList { project: String },
    /// Copy a built-in workflow into the project's `.warpforge/workflows/`
    /// directory so it can be customized. Refuses to overwrite an existing
    /// file. Returns `{ "path": … }`.
    #[serde(rename = "workflow.eject")]
    WorkflowEject { project: String, id: String },
    /// Soft-pause a running workflow pipeline: the current stage finishes its
    /// turn, the next stage does not start. Errors when the pipeline is not
    /// in a pausable state (already waiting for the user, or finished).
    #[serde(rename = "workflow.pause")]
    WorkflowPause { task: String },
    /// Resume a paused pipeline from its stage barrier. `note`, when set, is
    /// delivered to the next stage as an extra "User guidance" block.
    #[serde(rename = "workflow.resume")]
    WorkflowResume {
        task: String,
        #[serde(default)]
        note: Option<String>,
    },
    /// Answer a stage's pending `need_user_input` question. The message is
    /// forwarded verbatim to the session that asked. Errors unless the
    /// pipeline is waiting on a question.
    #[serde(rename = "workflow.reply")]
    WorkflowReply { task: String, message: String },
    /// Decide what an out-of-rounds pipeline does next. Errors unless the
    /// pipeline is waiting on a limit decision.
    #[serde(rename = "workflow.decide")]
    WorkflowDecide {
        task: String,
        decision: WorkflowDecision,
        /// For `extend`: how many extra review ⇄ fix rounds to grant (1..=5,
        /// default 1).
        #[serde(default)]
        rounds: Option<u32>,
        /// Optional extra guidance delivered to the next fix stage.
        #[serde(default)]
        note: Option<String>,
    },

    // ── Bootstrap wizard (desktop) ──
    /// Scan the repo, build the bootstrap prompt from the user's answers, and
    /// create a config-gen task. Returns `{ taskId }`.
    #[serde(rename = "bootstrap.start")]
    BootstrapStart {
        project: String,
        answers: BootstrapAnswers,
    },
    /// Extract the YAML from an agent response and validate it. Returns
    /// `{ yaml, issues: [{ severity, message }] }`.
    #[serde(rename = "bootstrap.finalize")]
    BootstrapFinalize { response: String },
    /// Read the project's current config file and validate it. Used after a
    /// bootstrap task to review what the agent wrote. Returns
    /// `{ yaml, issues: [{ severity, message }] }`.
    #[serde(rename = "bootstrap.readConfig")]
    BootstrapReadConfig { project: String },
    /// Write the accepted YAML to the project's config file. Returns
    /// `{ ok, path }`.
    #[serde(rename = "bootstrap.writeConfig")]
    BootstrapWriteConfig { project: String, yaml: String },

    // ── LSP ──
    /// Ensure a language server is running for a task's workspace + language.
    /// Reuses an existing server for the same (workspace, language). Returns
    /// [`LspStartResult`]; `available: false` when no server binary is on PATH.
    #[serde(rename = "lsp.start")]
    LspStart {
        task_id: String,
        language: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<String>,
    },
    /// Forward an opaque LSP JSON-RPC message to a running server's stdin.
    #[serde(rename = "lsp.send")]
    LspSend {
        server_id: String,
        payload: serde_json::Value,
    },
    /// Release one reference to a server; the process is killed once the last
    /// editor using it closes.
    #[serde(rename = "lsp.stop")]
    LspStop { server_id: String },
    /// Detect installed/updatable language servers for the supported languages.
    /// Returns `DetectedLanguageServer[]` with install/update commands and a
    /// freshness verdict, mirroring `agents.detect`.
    #[serde(rename = "lsp.detect")]
    LanguageServersDetect {},
    /// Install (when missing) or update (when behind) a supported language
    /// server. Returns `{ ok, command, output }`.
    #[serde(rename = "lsp.install")]
    LanguageServersInstall { id: String },

    // ── Issue trackers (GitHub / Linear sync) ──
    /// Current tracker connection state. Returns `{ linear: { connected,
    /// email?, organization? } | null, github: { connected, login? } | null }`.
    #[serde(rename = "tracker.status")]
    TrackerStatus {},
    /// Connect a Linear workspace using a personal API key. The key is stored
    /// encrypted (keychain on macOS). Returns the status object.
    #[serde(rename = "tracker.connectLinear")]
    TrackerConnectLinear { api_key: String },
    /// Disconnect Linear, deleting the stored key.
    #[serde(rename = "tracker.disconnectLinear")]
    TrackerDisconnectLinear {},
    /// Connect GitHub, verifying the user's `gh` CLI session. Returns the status
    /// object.
    #[serde(rename = "tracker.connectGithub")]
    TrackerConnectGithub { token: String },
    /// Disconnect GitHub (removes stored links; `gh` login itself is untouched).
    #[serde(rename = "tracker.disconnectGithub")]
    TrackerDisconnectGithub {},
    /// Every persisted backlog↔tracker link, so a client can hydrate its
    /// locally-stored backlog with remote ids/urls/status on connect.
    /// Returns `{ links: [TrackerLinkInfo] }`.
    #[serde(rename = "tracker.links")]
    TrackerLinks {},
    /// List every team the connected Linear key can see, so a project can be
    /// pointed at one. Returns `{ teams: [LinearTeam] }`.
    #[serde(rename = "tracker.linearTeams")]
    TrackerLinearTeams {},
    /// Read one image embedded in an issue body. The WebView has no tracker
    /// session of its own, so the daemon fetches the bytes with the
    /// credentials it already holds. Returns `TrackerAttachment`.
    #[serde(rename = "tracker.attachment")]
    TrackerAttachment {
        /// Absolute https URL, as it appeared in the issue body.
        url: String,
    },
    /// Which tracker slice a project reads. Returns `TrackerProjectSettings`.
    #[serde(rename = "tracker.projectSettings")]
    TrackerProjectSettings {
        /// Project key, e.g. "warpforge".
        project: String,
    },
    /// Point a project at a Linear team (or `null` to stop importing Linear
    /// into it). Changing this drops the rows the previous team imported.
    /// Returns the updated `TrackerProjectSettings`.
    #[serde(rename = "tracker.setProjectLinearTeam")]
    TrackerSetProjectLinearTeam {
        project: String,
        team_id: Option<String>,
        team_name: Option<String>,
    },
    /// List a project's open pull requests (GitHub only). Sorting/filtering
    /// happen at the daemon boundary; returns `[PullRequestSummary]`.
    #[serde(rename = "tracker.pulls.list")]
    TrackerPullsList {
        project: String,
        /// `open` or `all`.
        #[serde(default = "default_pull_state")]
        state: String,
        /// Restrict to PRs assigned to the authenticated user.
        #[serde(default)]
        assigned_to_me: bool,
        /// Substring filter over title/number, applied daemon-side.
        #[serde(default)]
        search: String,
        #[serde(default = "default_pull_limit")]
        limit: u32,
    },
    /// One pull request's body-level fields. Returns `PullRequestDetails`.
    #[serde(rename = "tracker.pulls.details")]
    TrackerPullDetails { project: String, number: u64 },
    /// One pull request's changes: file stats plus the raw unified patch.
    /// Returns `PullRequestDiff`.
    ///
    /// `from_oid`/`to_oid` narrow it to a slice of the pull request's commits:
    /// the comparison from `from_oid` (exclusive — it is the range base, i.e.
    /// the first selected commit's parent) to `to_oid` (inclusive). Both or
    /// neither; either alone is a bad request.
    #[serde(rename = "tracker.pulls.diff")]
    TrackerPullDiff {
        project: String,
        number: u64,
        #[serde(default)]
        from_oid: String,
        #[serde(default)]
        to_oid: String,
    },
    /// One pull request's commits, oldest first (the most recent 100 when
    /// there are more). Returns `{ items: [PullCommit] }`.
    #[serde(rename = "tracker.pulls.commits")]
    TrackerPullCommits { project: String, number: u64 },
    /// One pull request's conversation: comments, reviews, review threads.
    /// Returns `PullThread`.
    #[serde(rename = "tracker.pulls.thread")]
    TrackerPullThread { project: String, number: u64 },
    /// Post a conversation comment, or reply on a review thread when
    /// `in_reply_to` carries the thread's node id. Returns `{ url }`.
    #[serde(rename = "tracker.pulls.comment")]
    TrackerPullComment {
        project: String,
        number: u64,
        body: String,
        #[serde(default)]
        in_reply_to: String,
    },
    /// Start a new inline review thread on one line of a pull request's diff.
    /// `side` is `RIGHT` for a line of the post-image (added or unchanged) and
    /// `LEFT` for a line that the diff deleted. Returns `{ url }`.
    #[serde(rename = "tracker.pulls.reviewComment")]
    TrackerPullReviewComment {
        project: String,
        number: u64,
        path: String,
        line: u64,
        #[serde(default = "default_review_side")]
        side: String,
        body: String,
        /// First line of a multi-line comment: the thread spans
        /// `start_line..=line`, so it must be `<= line`. A single-line comment
        /// leaves this `None`.
        #[serde(default)]
        start_line: Option<u64>,
        /// Which image `start_line` belongs to, same `LEFT`/`RIGHT` vocabulary
        /// as `side`. Defaults to `side` when omitted, and like `start_line` is
        /// `None` for a single-line comment.
        #[serde(default)]
        start_side: Option<String>,
    },
    /// Submit a review verdict on a pull request: `APPROVE`,
    /// `REQUEST_CHANGES` or `COMMENT`. `REQUEST_CHANGES` needs a non-empty
    /// `body`; the others may leave it empty. Returns `{ url }` — the
    /// review's page URL.
    #[serde(rename = "tracker.pulls.review")]
    TrackerPullReview {
        project: String,
        number: u64,
        event: String,
        #[serde(default)]
        body: String,
    },
    /// Which sources this project can actually read and write. `local` is
    /// always true; Linear needs both a connected key and a mapped team;
    /// GitHub needs a `gh` session whose repo resolves from the project dir.
    /// Returns `ProjectSources`.
    #[serde(rename = "tracker.projectSources")]
    TrackerProjectSources {
        /// Project key, e.g. "warpforge".
        project: String,
    },
    /// Create an issue in an external tracker for a backlog item. Returns
    /// `{ itemId, externalId, url, status }`.
    #[serde(rename = "workItem.createExternal")]
    WorkItemCreateExternal {
        /// Client-generated backlog item id (uuid). The daemon keys its
        /// `tracker_links` row on this.
        item_id: String,
        /// Provider: "github" or "linear".
        provider: String,
        project: String,
        title: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        priority: WorkItemPriority,
        #[serde(default)]
        status: Option<String>,
    },
    /// Pull the latest status of external-tracker issues linked to backlog
    /// items. `ids` empty = all. Returns `{ items: [{ id, url, status }] }`.
    #[serde(rename = "workItem.syncExternal")]
    WorkItemSyncExternal {
        #[serde(default)]
        ids: Vec<String>,
    },
    /// Import open issues that exist in a tracker but have no backlog item yet.
    /// The daemon mints the item id and persists the link, so a client can
    /// insert the returned rows straight into its board.
    /// Returns `{ items: [ImportedWorkItem] }`.
    #[serde(rename = "workItem.importExternal")]
    WorkItemImportExternal {
        project: String,
        /// Provider: "github" or "linear". Omitted = every connected tracker.
        #[serde(default)]
        provider: Option<String>,
    },
    /// Read one server-paginated page from a connected external tracker.
    /// Sorting and filtering happen at the daemon boundary so the desktop does
    /// not import an entire repository into localStorage just to render a page.
    #[serde(rename = "workItem.list")]
    WorkItemList {
        project: String,
        provider: String,
        #[serde(default = "default_page")]
        page: u32,
        #[serde(default = "default_page_size")]
        page_size: u32,
        #[serde(default)]
        sort_by: String,
        #[serde(default)]
        sort_desc: bool,
        #[serde(default)]
        search: String,
        #[serde(default)]
        status: Option<String>,
    },
    /// Read the daemon-owned backlog storage configuration.
    #[serde(rename = "backlog.getSettings")]
    BacklogGetSettings {},
    /// Select YAML-file or SQLite backlog persistence.
    #[serde(rename = "backlog.setStorage")]
    BacklogSetStorage { mode: BacklogStorageMode },
    /// Read one task's full folded conversation history. Per-task and
    /// index-backed, so this stays fast even on large databases.
    #[serde(rename = "session.history")]
    SessionHistory { task_id: String },
    /// Read the task-history retention configuration.
    #[serde(rename = "history.getSettings")]
    HistoryGetSettings {},
    /// Set how long finished tasks keep their data, in days. `0` disables a
    /// stage. Applies (and sweeps) immediately.
    #[serde(rename = "history.setSettings")]
    HistorySetSettings {
        /// Days before a closed task's conversation is deleted.
        retention_days: u32,
        /// Days before an ignored diff-less waiting task is settled. `0` = off.
        settle_ignored_after_days: u32,
        /// Days before an untouched closed task is deleted outright. `0` = off.
        delete_closed_after_days: u32,
    },
    /// Read one project-scoped backlog page from the configured backend.
    #[serde(rename = "backlog.list")]
    BacklogList {
        project: String,
        #[serde(default = "default_page")]
        page: u32,
        #[serde(default = "default_page_size")]
        page_size: u32,
        #[serde(default)]
        sort_by: String,
        #[serde(default)]
        sort_desc: bool,
        #[serde(default)]
        search: String,
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        priority: Option<String>,
        #[serde(default)]
        assignee: Option<String>,
    },
    /// Create a local backlog item in configured storage.
    #[serde(rename = "backlog.create")]
    BacklogCreate {
        project: String,
        title: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        status: String,
        #[serde(default)]
        priority: String,
        #[serde(default)]
        source: String,
        #[serde(default)]
        assignee: Option<String>,
    },
    /// Edit a backlog item's own fields. Every field is optional: absent means
    /// "leave alone", so one call can change just a priority. Returns the item.
    #[serde(rename = "backlog.update")]
    BacklogUpdate {
        item_id: String,
        project: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        body: Option<String>,
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        priority: Option<String>,
        #[serde(default)]
        assignee: Option<String>,
    },
    #[serde(rename = "backlog.attachExternal")]
    BacklogAttachExternal {
        item_id: String,
        project: String,
        provider: String,
        external_id: String,
        url: String,
        #[serde(default)]
        remote_status: Option<String>,
    },
    /// Delete a backlog item and its tracker link (rollback for a failed
    /// external create). Returns `{ ok }`.
    #[serde(rename = "backlog.delete")]
    BacklogDelete { item_id: String, project: String },
    /// Link a daemon task to a backlog item (created when a backlog item starts
    /// its first task). Returns `{ ok }`.
    #[serde(rename = "workItem.linkTask")]
    WorkItemLinkTask { item_id: String, task_id: String },

    // ── Automations ──────────────────────────────────────────────────────────
    /// Every automation, newest first, optionally narrowed to one project.
    /// Automations are deliberately *not* in the connect [`Snapshot`]: a cold
    /// connect must not read state no view has asked for yet.
    #[serde(rename = "automation.list")]
    AutomationList {
        #[serde(default)]
        project: Option<String>,
    },
    #[serde(rename = "automation.show")]
    AutomationShow { id: String },
    /// Create an automation. Rejected if the cron expression or the timezone
    /// cannot be parsed — an unschedulable row is never persisted.
    #[serde(rename = "automation.create")]
    AutomationCreate {
        project: String,
        name: String,
        prompt: String,
        agent: String,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        config_overrides: HashMap<String, String>,
        trigger: AutomationTrigger,
        #[serde(default)]
        timezone: String,
        #[serde(default)]
        precheck: Option<String>,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default = "default_missed_run_grace_minutes")]
        missed_run_grace_minutes: u32,
        #[serde(default)]
        reuse_session: bool,
        #[serde(default)]
        worktree: bool,
    },
    /// Patch an automation. Absent fields are left alone. Returns the row.
    #[serde(rename = "automation.update")]
    AutomationUpdate { id: String, patch: AutomationPatch },
    /// Delete an automation and its run history. Returns `{ ok }`.
    #[serde(rename = "automation.delete")]
    AutomationDelete { id: String },
    /// Run an automation now. Skips the precheck and the missed-run grace check
    /// (an explicit click means run) but still refuses to overlap a live run.
    /// Does not move the next scheduled occurrence.
    #[serde(rename = "automation.runNow")]
    AutomationRunNow { id: String },
    /// Run history for one automation, newest first.
    #[serde(rename = "automation.runs")]
    AutomationRuns {
        id: String,
        #[serde(default)]
        limit: Option<u32>,
    },
}
