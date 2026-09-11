//! Request dispatcher: the single exhaustive `match` over `wire::Method`.
//!
//! Every arm destructures its variant and delegates to a topic module under
//! [`dispatch`](self). Keeping the match exhaustive in one place means a new
//! method variant fails to compile here instead of becoming a silent no-op.

use warpforge_protocol as wire;

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::ServerLifecycle;

mod agents;
mod automations;
mod backlog;
mod branch;
mod files;
mod git;
mod history;
mod lsp;
mod memory;
mod orchestration;
mod project;
mod runtime;
mod sessions;
mod shelf;
mod system;
mod tasks;
mod tracker;
mod workflow;
mod workitem;

#[rustfmt::skip]
pub(super) async fn dispatch(
    handle: &DaemonHandle,
    method: wire::Method,
    lifecycle: &std::sync::Arc<ServerLifecycle>,
) -> Result<serde_json::Value, wire::RpcError> {
    use wire::Method::*;
    match method {
        SystemHandshake { client_version, protocol_version, } => system::system_handshake(lifecycle, client_version, protocol_version).await,
        UpdatePrepareShutdown { expected_daemon_version, protocol_version, } => system::update_prepare_shutdown(handle, lifecycle, expected_daemon_version, protocol_version).await,
        StateSubscribe { .. } => system::state_subscribe().await,
        AutomationList { .. } | AutomationShow { .. } | AutomationCreate { .. } | AutomationUpdate { .. } | AutomationDelete { .. } | AutomationRunNow { .. } | AutomationRuns { .. } => automations::automations(handle, method).await,
        RuntimeStopAll {} => runtime::runtime_stop_all(handle).await,
        LspStart { task_id, language, project, } => lsp::lsp_start(handle, task_id, language, project).await,
        LspSend { server_id, payload } => lsp::lsp_send(handle, server_id, payload).await,
        LspStop { server_id } => lsp::lsp_stop(handle, server_id).await,
        LanguageServersDetect {} => lsp::language_servers_detect().await,
        LanguageServersInstall { id } => lsp::language_servers_install(id).await,
        ServiceLogs { project, service, after, limit, } => runtime::service_logs(handle, project, service, after, limit).await,
        ServiceStart { project, service } => runtime::service_start(handle, project, service).await,
        ServiceStop { project, service } => runtime::service_stop(handle, project, service).await,
        ServiceRestart { project, service } => runtime::service_restart(handle, project, service).await,
        ServiceStartAll { project } => runtime::service_start_all(handle, project).await,
        ServiceStopAll { project } => runtime::service_stop_all(handle, project).await,
        PortForwardStartAll { project } => runtime::port_forward_start_all(handle, project).await,
        PortForwardStart { project, name } => runtime::port_forward_start(handle, project, name).await,
        TaskCreate { project, prompt, agent, tags, include_runtime_context, worktree, parent_task_id, attachments, default_model, config_overrides, workflow, backlog_item_id, origin, start, } => tasks::task_create(handle, project, prompt, agent, tags, include_runtime_context, worktree, parent_task_id, attachments, default_model, config_overrides, workflow, backlog_item_id, origin, start).await,
        OrchestratorReadInbox { parent_task_id } => orchestration::orchestrator_read_inbox(handle, parent_task_id).await,
        OrchestratorListAgents { parent_task_id, project, } => orchestration::orchestrator_list_agents(handle, parent_task_id, project).await,
        DiffGet { task_id, include_ignored, } => files::diff_get(handle, task_id, include_ignored).await,
        MemoryStore { content, scope, kind, tags, project_id, } => memory::memory_store(handle, content, scope, kind, tags, project_id).await,
        MemorySearch { query, scope, limit, mode, } => memory::memory_search(handle, query, scope, limit, mode).await,
        MemoryList { scope, kind, limit, offset, } => memory::memory_list(handle, scope, kind, limit, offset).await,
        MemoryUpdate { id, content } => memory::memory_update(handle, id, content).await,
        MemoryDelete { id } => memory::memory_delete(handle, id).await,
        MemoryStats {} => memory::memory_stats(handle).await,
        MemorySetEmbedding { mode } => memory::memory_set_embedding(handle, mode).await,
        MemoryAddEdge { src_id, dst_id, relation, } => memory::memory_add_edge(handle, src_id, dst_id, relation).await,
        MemoryEdges { id } => memory::memory_edges(handle, id).await,
        DiffResolveHunk { task_id, file, hunk_index, resolution, } => files::diff_resolve_hunk(handle, task_id, file, hunk_index, resolution).await,
        FileContents { task_id, path, project, } => files::file_contents(handle, task_id, path, project).await,
        FileList { task_id, project, include_ignored, } => files::file_list(handle, task_id, project, include_ignored).await,
        FileSave { task_id, path, content, project, } => files::file_save(handle, task_id, path, content, project).await,
        FileCreate { task_id, path, directory, } => files::file_create(handle, task_id, path, directory).await,
        FileRename { task_id, path, new_path, } => files::file_rename(handle, task_id, path, new_path).await,
        FileDelete { task_id, path } => files::file_delete(handle, task_id, path).await,
        FileSearch { task_id, query, limit, project, } => files::file_search(handle, task_id, query, limit, project).await,
        GitCommit { task_id, message, files, amend, project, } => git::git_commit(handle, task_id, message, files, amend, project).await,
        GitUpdate { task_id } => git::git_update(handle, task_id).await,
        GitBranches { task_id, project } => git::git_branches(handle, task_id, project).await,
        GitRoots { task_id, project } => git::git_roots(handle, task_id, project).await,
        GitIgnored { task_id, project } => git::git_ignored(handle, task_id, project).await,
        GitAdd { task_id, paths } => git::git_add(handle, task_id, paths).await,
        GitIgnore { task_id, paths } => git::git_ignore(handle, task_id, paths).await,
        ShelfList { task_id } => shelf::shelf_list(handle, task_id).await,
        ShelfCreate { task_id, name, paths, } => shelf::shelf_create(handle, task_id, name, paths).await,
        ShelfGet { task_id, id } => shelf::shelf_get(handle, task_id, id).await,
        ShelfApply { task_id, id, drop } => shelf::shelf_apply(handle, task_id, id, drop).await,
        ShelfDrop { task_id, id } => shelf::shelf_drop(handle, task_id, id).await,
        StashList { task_id } => shelf::stash_list(handle, task_id).await,
        StashPush { task_id, message, paths, } => shelf::stash_push(handle, task_id, message, paths).await,
        StashGet { task_id, id } => shelf::stash_get(handle, task_id, id).await,
        StashApply { task_id, id, pop } => shelf::stash_apply(handle, task_id, id, pop).await,
        StashFile { task_id, id, paths } => shelf::stash_file(handle, task_id, id, paths).await,
        StashDrop { task_id, id } => shelf::stash_drop(handle, task_id, id).await,
        GitSwitchBranch { task_id, branch } => branch::git_switch_branch(handle, task_id, branch).await,
        GitBranchRename { task_id, branch, new_name, } => branch::git_branch_rename(handle, task_id, branch, new_name).await,
        GitBranchDelete { task_id, branch, force, } => branch::git_branch_delete(handle, task_id, branch, force).await,
        GitBranchCreate { task_id, name, from, checkout, overwrite, } => branch::git_branch_create(handle, task_id, name, from, checkout, overwrite).await,
        GitRebase { task_id, branch, target, } => branch::git_rebase(handle, task_id, branch, target).await,
        GitMerge { task_id, target } => branch::git_merge(handle, task_id, target).await,
        GitLastCommitMessage { task_id } => git::git_last_commit_message(handle, task_id).await,
        GitPushInfo { task_id } => git::git_push_info(handle, task_id).await,
        GitPush { task_id, force } => git::git_push(handle, task_id, force).await,
        GitCreatePr { task_id, title, body, base, } => git::git_create_pr(handle, task_id, title, body, base).await,
        TextGenerate { task_id, agent_id, kind, model, account_id, input, } => agents::text_generate(handle, task_id, agent_id, kind, model, account_id, input).await,
        TextEnhance { project, agent_id, prompt, model, } => agents::text_enhance(handle, project, agent_id, prompt, model).await,
        TaskCancel { task_id } => tasks::task_cancel(handle, task_id).await,
        TaskArchive { task_id } => tasks::task_archive(handle, task_id).await,
        TaskDelete { task_id } => tasks::task_delete(handle, task_id).await,
        TaskDeleteSettled { project } => tasks::task_delete_settled(handle, project).await,
        TaskSetTitle { task_id, title } => tasks::task_set_title(handle, task_id, title).await,
        TaskMergeWorktree { task_id } => tasks::task_merge_worktree(handle, task_id).await,
        TaskListWorktrees { project } => tasks::task_list_worktrees(handle, project).await,
        TaskSettle { task_id } => tasks::task_settle(handle, task_id).await,
        TaskUnsettle { task_id } => tasks::task_unsettle(handle, task_id).await,
        TaskSnooze { task_id, until } => tasks::task_snooze(handle, task_id, until).await,
        TaskUnsnooze { task_id } => tasks::task_unsnooze(handle, task_id).await,
        SessionsList { project } => sessions::sessions_list(handle, project).await,
        TaskResume { project, agent, session_id, title, } => tasks::task_resume(handle, project, agent, session_id, title).await,
        SessionPrompt { task_id, text, attachments, } => sessions::session_prompt(handle, task_id, text, attachments).await,
        SessionSetConfigOption { task_id, config_id, value, } => sessions::session_set_config_option(handle, task_id, config_id, value).await,
        SessionPermission { task_id, request_id, outcome, } => sessions::session_permission(handle, task_id, request_id, outcome).await,
        PortForwardStop { project, name } => runtime::port_forward_stop(handle, project, name).await,
        PortForwardStopAll { project } => runtime::port_forward_stop_all(handle, project).await,
        PortForwardLogs { project, name, after, limit, } => runtime::port_forward_logs(handle, project, name, after, limit).await,
        RuntimeList { project } => runtime::runtime_list(handle, project).await,
        // ── Legacy PTY terminals (the TUI's live agent panes) ──
        TerminalSpawn { project, command, cols, rows, } => runtime::terminal_spawn(handle, project, command, cols, rows).await,
        TerminalInput { terminal_id, data_b64, } => runtime::terminal_input(handle, terminal_id, data_b64).await,
        TerminalResize { terminal_id, cols, rows, } => runtime::terminal_resize(handle, terminal_id, cols, rows).await,
        TerminalKill { terminal_id } => runtime::terminal_kill(handle, terminal_id).await,
        AgentsDetect {} => agents::agents_detect(handle).await,
        AgentsUpdate { agents } => agents::agents_update(handle, agents).await,
        AgentsInstall { id } => agents::agents_install(id).await,
        AgentsProbe { id } => agents::agents_probe(handle, id).await,
        AgentsList {} => agents::agents_list(handle).await,
        // ── Agent accounts ──
        AccountsList {} => agents::accounts_list(handle).await,
        AccountsImport { agent_id, label } => agents::accounts_import(handle, agent_id, label).await,
        AccountsRename { account_id, label } => agents::accounts_rename(handle, account_id, label).await,
        AccountsRemove { account_id } => agents::accounts_remove(handle, account_id).await,
        ListAgentLimits { refresh } => agents::list_agent_limits(handle, refresh).await,
        ListAgentSpend {} => agents::list_agent_spend(handle).await,
        AccountsSetActive { agent_id, account_id, } => agents::accounts_set_active(handle, agent_id, account_id).await,
        // ── Orchestration ──
        OrchestrateStart { project, goal } => orchestration::orchestrate_start(handle, project, goal).await,
        OrchestrateList {} => orchestration::orchestrate_list(handle).await,
        OrchestrateCancel { .. } => orchestration::orchestrate_cancel().await,
        OrchestrateGetConfig {} => orchestration::orchestrate_get_config(handle).await,
        OrchestrateSaveConfig { config } => orchestration::orchestrate_save_config(handle, config).await,
        // ── Workflows ──
        WorkflowList { project } => workflow::workflow_list(handle, project).await,
        WorkflowEject { project, id } => workflow::workflow_eject(handle, project, id).await,
        WorkflowPause { task } => workflow::workflow_pause(handle, task).await,
        WorkflowResume { task, note } => workflow::workflow_resume(handle, task, note).await,
        WorkflowReply { task, message } => workflow::workflow_reply(handle, task, message).await,
        WorkflowDecide { task, decision, rounds, note, } => workflow::workflow_decide(handle, task, decision, rounds, note).await,
        ProjectAdd { path, name, port_range, } => project::project_add(handle, path, name, port_range).await,
        ProjectRemove { name, stop_resources, } => project::project_remove(handle, name, stop_resources).await,
        ProjectSetPortRange { project, range } => project::project_set_port_range(handle, project, range).await,
        BootstrapStart { project, answers } => project::bootstrap_start(handle, project, answers).await,
        BootstrapFinalize { response } => project::bootstrap_finalize(response).await,
        BootstrapReadConfig { project } => project::bootstrap_read_config(handle, project).await,
        BootstrapWriteConfig { project, yaml } => project::bootstrap_write_config(handle, project, yaml).await,
        // The tracker calls below run on this request task, never inside the
        // actor: the actor loop is single-threaded and awaits its handlers
        // inline, so a `gh` spawn made in there stalls every project until the
        // network answers. Only the store writes go through the actor.
        TrackerStatus {} => tracker::tracker_status().await,
        TrackerConnectLinear { api_key } => tracker::tracker_connect_linear(api_key).await,
        TrackerDisconnectLinear {} => tracker::tracker_disconnect_linear().await,
        TrackerConnectGithub { token } => tracker::tracker_connect_github(token).await,
        TrackerDisconnectGithub {} => tracker::tracker_disconnect_github().await,
        TrackerLinks {} => tracker::tracker_links(handle).await,
        WorkItemCreateExternal { item_id, provider, project, title, body, priority: _priority, status: _status, } => workitem::work_item_create_external(handle, item_id, provider, project, title, body).await,
        TrackerLinearTeams {} => tracker::tracker_linear_teams().await,
        // Network on the request task, never through the actor (ADR-0002
        // invariant 1) — an image fetch must not stall every other project.
        TrackerAttachment { url } => tracker::tracker_attachment(url).await,
        TrackerProjectSettings { project } => tracker::tracker_project_settings(handle, project).await,
        TrackerSetProjectLinearTeam { project, team_id, team_name, } => tracker::tracker_set_project_linear_team(handle, project, team_id, team_name).await,
        TrackerProjectSources { project } => tracker::tracker_project_sources(handle, project).await,
        // The PR inbox reads run on the request task like every other tracker
        // call (ADR-0002 invariant 1): the actor loop must never wait on `gh`.
        TrackerPullsList { project, state, assigned_to_me, search, limit, } => tracker::tracker_pulls_list(handle, project, state, assigned_to_me, search, limit).await,
        TrackerPullDetails { project, number } => tracker::tracker_pull_details(handle, project, number).await,
        TrackerPullDiff { project, number, from_oid, to_oid, } => tracker::tracker_pull_diff(handle, project, number, from_oid, to_oid).await,
        TrackerPullCommits { project, number } => tracker::tracker_pull_commits(handle, project, number).await,
        TrackerPullThread { project, number } => tracker::tracker_pull_thread(handle, project, number).await,
        TrackerPullComment { project, number, body, in_reply_to, } => tracker::tracker_pull_comment(handle, project, number, body, in_reply_to).await,
        TrackerPullReviewComment { project, number, path, line, side, body, start_line, start_side, } => tracker::tracker_pull_review_comment(handle, project, number, path, line, side, body, start_line, start_side).await,
        // The verdict write runs here on the request task like the other PR
        // network calls (ADR-0002 invariant 1).
        TrackerPullReview { project, number, event, body, } => tracker::tracker_pull_review(handle, project, number, event, body).await,
        WorkItemSyncExternal { ids } => workitem::work_item_sync_external(handle, ids).await,
        WorkItemImportExternal { project, provider } => workitem::work_item_import_external(handle, project, provider).await,
        WorkItemList { project, provider, page, page_size, sort_by, sort_desc, search, status, } => workitem::work_item_list(handle, project, provider, page, page_size, sort_by, sort_desc, search, status).await,
        BacklogGetSettings {} => backlog::backlog_get_settings(handle).await,
        BacklogSetStorage { mode } => backlog::backlog_set_storage(handle, mode).await,
        SessionHistory { task_id } => sessions::session_history(handle, task_id).await,
        HistoryGetSettings {} => history::history_get_settings(handle).await,
        HistorySetSettings { retention_days, settle_ignored_after_days, delete_closed_after_days, } => history::history_set_settings(handle, retention_days, settle_ignored_after_days, delete_closed_after_days).await,
        BacklogList { project, page, page_size, sort_by, sort_desc, search, status, source, priority, assignee, } => backlog::backlog_list(handle, project, page, page_size, sort_by, sort_desc, search, status, source, priority, assignee).await,
        BacklogCreate { project, title, body, status, priority, source, assignee, } => backlog::backlog_create(handle, project, title, body, status, priority, source, assignee).await,
        BacklogUpdate { item_id, project, title, body, status, priority, assignee, } => backlog::backlog_update(handle, item_id, project, title, body, status, priority, assignee).await,
        BacklogAttachExternal { item_id, project, provider, external_id, url, remote_status, } => backlog::backlog_attach_external(handle, item_id, project, provider, external_id, url, remote_status).await,
        BacklogDelete { item_id, project } => backlog::backlog_delete(handle, item_id, project).await,
        WorkItemLinkTask { item_id, task_id } => backlog::work_item_link_task(handle, item_id, task_id).await,
        MemoryDream { dry_run, project_id, } => memory::memory_dream(handle, dry_run, project_id).await,
        MemoryListCompaction {} => memory::memory_list_compaction(handle).await,
        MemoryResolveCompaction { id, approve } => memory::memory_resolve_compaction(handle, id, approve).await,
    }
}
