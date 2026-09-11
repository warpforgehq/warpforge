use crate::*;
use std::collections::HashMap;

#[test]
fn task_status_waiting_absorbs_the_legacy_spellings() {
    // A daemon may be newer than the client that persisted a snapshot, and
    // `task.updated` payloads are replayed from disk — so both pre-merge
    // spellings must still deserialize.
    let from_idle: TaskStatus = serde_json::from_str(r#""idle""#).unwrap();
    let from_review: TaskStatus = serde_json::from_str(r#""needs_review""#).unwrap();
    assert_eq!(from_idle, TaskStatus::Waiting);
    assert_eq!(from_review, TaskStatus::Waiting);

    // Only the new spelling is ever written.
    assert_eq!(
        serde_json::to_string(&TaskStatus::Waiting).unwrap(),
        r#""waiting""#
    );
}

#[test]
fn agents_detect_roundtrip() {
    // Struct variant with empty params — client always sends params:{}.
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":1,"method":"agents.detect","params":{}}"#).unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert_eq!(req.id, 1);
    assert!(matches!(req.method, Method::AgentsDetect {}));
}

#[test]
fn agents_probe_roundtrip() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":4,"method":"agents.probe","params":{"id":"opencode"}}"#)
            .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(matches!(req.method, Method::AgentsProbe { id } if id == "opencode"));
}

#[test]
fn git_last_commit_message_roundtrip() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{"id":5,"method":"git.lastCommitMessage","params":{"task_id":"t1"}}"#,
    )
    .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(matches!(req.method, Method::GitLastCommitMessage { task_id } if task_id == "t1"));
}

#[test]
fn git_roots_roundtrip() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":6,"method":"git.roots","params":{"task_id":"t1"}}"#).unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(
        matches!(req.method, Method::GitRoots { task_id, project } if task_id.as_deref() == Some("t1") && project.is_none())
    );
}

/// The ignored-file scan is opt-in: a client that never asks must not pay
/// for it, so the flag has to default to false when the param is absent.
#[test]
fn diff_get_defaults_to_skipping_ignored_files() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":7,"method":"diff.get","params":{"task_id":"t1"}}"#).unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(matches!(
        req.method,
        Method::DiffGet {
            include_ignored: false,
            ..
        }
    ));
}

#[test]
fn git_ignored_parses_task_or_project_params() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":8,"method":"git.ignored","params":{"project":"demo"}}"#)
            .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(
        matches!(req.method, Method::GitIgnored { task_id, project } if task_id.is_none() && project.as_deref() == Some("demo"))
    );
}

#[test]
fn git_add_and_ignore_carry_paths_on_the_wire() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{"id":9,"method":"git.add","params":{"task_id":"t1","paths":["new.txt"]}}"#,
    )
    .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(
        matches!(req.method, Method::GitAdd { task_id, paths } if task_id == "t1" && paths == vec!["new.txt"])
    );

    let json: serde_json::Value = serde_json::from_str(
        r#"{"id":10,"method":"git.ignore","params":{"task_id":"t1","paths":["*.log"]}}"#,
    )
    .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(
        matches!(req.method, Method::GitIgnore { task_id, paths } if task_id == "t1" && paths == vec!["*.log"])
    );
}

#[test]
fn stash_push_parses_message_and_optional_paths() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{"id":16,"method":"stash.push","params":{"task_id":"t1","message":"wip","paths":["a.ts"]}}"#,
    )
    .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(
        matches!(req.method, Method::StashPush { message, paths, .. } if message == "wip" && paths == Some(vec!["a.ts".to_string()]))
    );

    // Both optional: bare push stashes everything with git's default name.
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":17,"method":"stash.push","params":{"task_id":"t1"}}"#)
            .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(
        matches!(req.method, Method::StashPush { message, paths, .. } if message.is_empty() && paths.is_none())
    );
}

#[test]
fn shelf_methods_parse_and_default_sensibly() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":11,"method":"shelf.create","params":{"task_id":"t1"}}"#)
            .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(
        matches!(req.method, Method::ShelfCreate { task_id, name, paths } if task_id == "t1" && name.is_empty() && paths.is_none())
    );

    // `drop` defaults to true: unshelving cleans up unless asked not to.
    let json: serde_json::Value = serde_json::from_str(
        r#"{"id":12,"method":"shelf.apply","params":{"task_id":"t1","id":"abc"}}"#,
    )
    .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(matches!(req.method, Method::ShelfApply { drop, .. } if drop));

    // Old entries without branch/files still read.
    let entry: ShelfEntry =
        serde_json::from_value(serde_json::json!({"id": "a", "name": "wip", "createdAt": 1}))
            .unwrap();
    assert!(entry.branch.is_none());
    assert!(entry.files.is_empty());
}

#[test]
fn stash_methods_parse_and_default_sensibly() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"id":13,"method":"stash.list","params":{"task_id":"t1"}}"#)
            .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(matches!(req.method, Method::StashList { .. }));

    // `pop` defaults to false: applying keeps the entry unless asked to pop.
    let json: serde_json::Value = serde_json::from_str(
        r#"{"id":14,"method":"stash.apply","params":{"task_id":"t1","id":"stash@{0}"}}"#,
    )
    .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(matches!(req.method, Method::StashApply { pop: false, .. }));

    let json: serde_json::Value = serde_json::from_str(
        r#"{"id":15,"method":"stash.file","params":{"task_id":"t1","id":"stash@{0}","paths":["a.ts"]}}"#,
    )
    .unwrap();
    let req: Request = serde_json::from_value(json).unwrap();
    assert!(matches!(req.method, Method::StashFile { paths, .. } if paths == vec!["a.ts"]));
}

#[test]
fn orchestrator_list_agents_wire_shape() {
    let req = Request {
        id: 9,
        method: Method::OrchestratorListAgents {
            parent_task_id: "t_parent".into(),
            project: Some("demo".into()),
        },
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["method"], "orchestrator.listAgents");
    assert_eq!(json["params"]["parent_task_id"], "t_parent");
    assert_eq!(json["params"]["project"], "demo");

    let back: Request = serde_json::from_value(json).unwrap();
    assert_eq!(back, req);

    let no_project: Request = serde_json::from_value(serde_json::json!({
        "id": 10,
        "method": "orchestrator.listAgents",
        "params": { "parent_task_id": "t_parent" }
    }))
    .unwrap();
    assert!(matches!(
        no_project.method,
        Method::OrchestratorListAgents { project: None, .. }
    ));
}

#[test]
fn request_wire_shape() {
    let req = Request {
        id: 7,
        method: Method::TaskCreate {
            project: "my-app".into(),
            prompt: "fix the login bug".into(),
            agent: "claude".into(),
            tags: vec!["bug".into()],
            include_runtime_context: true,
            worktree: false,
            parent_task_id: None,
            attachments: vec![],
            default_model: Some("opus".into()),
            config_overrides: Default::default(),
            workflow: None,
            backlog_item_id: None,
            origin: None,
            start: true,
        },
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["id"], 7);
    assert_eq!(json["method"], "task.create");
    assert_eq!(json["params"]["project"], "my-app");

    let back: Request = serde_json::from_value(json).unwrap();
    assert_eq!(back, req);
}

#[test]
fn update_methods_keep_the_documented_wire_shape() {
    let handshake = serde_json::to_value(Request {
        id: 1,
        method: Method::SystemHandshake {
            client_version: "0.2.0".into(),
            protocol_version: PROTOCOL_VERSION,
        },
    })
    .unwrap();
    assert_eq!(handshake["method"], "system.handshake");
    assert_eq!(handshake["params"]["client_version"], "0.2.0");

    let handoff = serde_json::to_value(Request {
        id: 2,
        method: Method::UpdatePrepareShutdown {
            expected_daemon_version: "0.2.0".into(),
            protocol_version: PROTOCOL_VERSION,
        },
    })
    .unwrap();
    assert_eq!(handoff["method"], "update.prepareShutdown");
    assert_eq!(handoff["params"]["expected_daemon_version"], "0.2.0");
}

#[test]
fn terminal_spawn_defaults_cols_rows_when_omitted() {
    let old: Request = serde_json::from_str(
        r#"{"id":1,"method":"terminal.spawn","params":{"project":"p","command":"sh"}}"#,
    )
    .unwrap();
    assert!(
        matches!(old.method, Method::TerminalSpawn { cols, rows, .. } if cols == 80 && rows == 24)
    );
}

#[test]
fn terminal_spawn_uses_provided_cols_rows() {
    let req: Request = serde_json::from_str(
        r#"{"id":1,"method":"terminal.spawn","params":{"project":"p","command":"sh","cols":120,"rows":40}}"#,
    )
    .unwrap();
    assert!(
        matches!(req.method, Method::TerminalSpawn { cols, rows, .. } if cols == 120 && rows == 40)
    );
}

#[test]
fn project_remove_defaults_to_safe_resource_guard() {
    let old: Request =
        serde_json::from_str(r#"{"id":1,"method":"project.remove","params":{"name":"demo"}}"#)
            .unwrap();
    assert!(matches!(
        old.method,
        Method::ProjectRemove {
            name,
            stop_resources: false
        } if name == "demo"
    ));

    let authorized: Request = serde_json::from_str(
        r#"{"id":2,"method":"project.remove","params":{"name":"demo","stop_resources":true}}"#,
    )
    .unwrap();
    assert!(matches!(
        authorized.method,
        Method::ProjectRemove {
            stop_resources: true,
            ..
        }
    ));
}

#[test]
fn prompt_attachments_are_backward_compatible_and_roundtrip() {
    let old: Request = serde_json::from_str(
        r#"{"id":1,"method":"session.prompt","params":{"task_id":"t1","text":"hi"}}"#,
    )
    .unwrap();
    assert!(
        matches!(old.method, Method::SessionPrompt { attachments, .. } if attachments.is_empty())
    );

    for attachment in [
        PromptAttachment::File {
            path: "src/main.rs".into(),
            range: None,
        },
        PromptAttachment::File {
            path: "src/main.rs".into(),
            range: Some(LineRange { start: 4, end: 12 }),
        },
        PromptAttachment::Image {
            name: "shot.png".into(),
            mime_type: "image/png".into(),
            data: "AA==".into(),
        },
        PromptAttachment::Document {
            name: "notes.md".into(),
            mime_type: "text/markdown".into(),
            text: "# hi".into(),
        },
    ] {
        let value = serde_json::to_value(&attachment).unwrap();
        assert!(value["type"].is_string());
        assert_eq!(
            serde_json::from_value::<PromptAttachment>(value).unwrap(),
            attachment
        );
    }
    assert_eq!(
        serde_json::to_value(PromptAttachment::Document {
            name: "notes.md".into(),
            mime_type: "text/markdown".into(),
            text: "# hi".into(),
        })
        .unwrap(),
        serde_json::json!({
            "type": "document",
            "name": "notes.md",
            "mimeType": "text/markdown",
            "text": "# hi"
        })
    );

    let old_history: SessionUpdate =
        serde_json::from_str(r#"{"kind":"user_message","text":"hello"}"#).unwrap();
    assert!(
        matches!(old_history, SessionUpdate::UserMessage { attachments, .. } if attachments.is_empty())
    );

    let old_tool: SessionUpdate = serde_json::from_str(
        r#"{"kind":"tool_call","tool_call_id":"t1","title":"wait","status":"in_progress","tool_kind":"execute"}"#,
    )
    .unwrap();
    assert!(matches!(
        old_tool,
        SessionUpdate::ToolCall {
            started_at: None,
            ..
        }
    ));

    let old_file_edit: SessionUpdate =
        serde_json::from_str(r#"{"kind":"file_edit","path":"src/main.rs"}"#).unwrap();
    assert!(matches!(
        old_file_edit,
        SessionUpdate::FileEdit {
            tool_call_id: None,
            additions: None,
            deletions: None,
            hunks,
            ..
        } if hunks.is_empty()
    ));

    let detailed_file_edit = SessionUpdate::FileEdit {
        path: "src/main.rs".into(),
        tool_call_id: Some("edit-1".into()),
        additions: Some(1),
        deletions: Some(1),
        hunks: vec![EditHunk {
            old_start: 4,
            old_lines: 1,
            new_start: 4,
            new_lines: 1,
            lines: vec!["-old".into(), "+new".into()],
        }],
    };
    let value = serde_json::to_value(&detailed_file_edit).unwrap();
    assert_eq!(value["hunks"][0]["newStart"], 4);
    assert_eq!(
        serde_json::from_value::<SessionUpdate>(value).unwrap(),
        detailed_file_edit
    );
}

#[test]
fn workflow_event_keeps_agent_links_as_distinct_wire_records() {
    let update = SessionUpdate::WorkflowEvent {
        event: WorkflowEventKind::StageStarted,
        title: "Implement started".into(),
        detail: None,
        stage: Some(WorkflowStage::Implement),
        agents: vec![WorkflowEventAgent {
            task_id: "t_impl".into(),
            label: "implement".into(),
            agent: "codex".into(),
            model: Some("gpt-5.6-sol".into()),
        }],
        tone: WorkflowEventTone::Running,
    };
    let value = serde_json::to_value(&update).unwrap();
    assert_eq!(value["kind"], "workflow_event");
    assert_eq!(value["event"], "stage_started");
    assert_eq!(value["stage"], "implement");
    assert_eq!(value["agents"][0]["taskId"], "t_impl");
    assert_eq!(
        serde_json::from_value::<SessionUpdate>(value).unwrap(),
        update
    );
}

#[test]
fn event_wire_shape() {
    let ev = Event::ServiceLog {
        project: "my-app".into(),
        service: "db".into(),
        seq: 42,
        line: "ready".into(),
    };
    let json = serde_json::to_value(ServerMessage::Event(ev.clone())).unwrap();
    assert_eq!(json["event"], "service.log");
    assert_eq!(json["data"]["seq"], 42);

    let back: ServerMessage = serde_json::from_value(json).unwrap();
    assert_eq!(back, ServerMessage::Event(ev));
}

#[test]
fn snapshot_event_roundtrip() {
    let ev = Event::Snapshot(Snapshot::default());
    let json = serde_json::to_string(&ev).unwrap();
    let back: Event = serde_json::from_str(&json).unwrap();
    assert_eq!(back, ev);
}

#[test]
fn project_config_changed_event_roundtrip() {
    let ev = Event::ProjectConfigChanged(ProjectConfigState {
        project: ProjectInfo {
            name: "demo".into(),
            path: "/tmp/demo".into(),
            port_range: (4000, 4099),
            port_range_source: PortRangeSource::Auto,
            port_range_conflict: None,
            declared_services: vec!["web".into()],
            agent_templates: HashMap::new(),
        },
        services: vec![ServiceInfo {
            project: "demo".into(),
            name: "web".into(),
            command: "npm run dev".into(),
            status: ServiceStatus::Stopped,
            original_port: 3000,
            allocated_port: 0,
            port_pinned: false,
            log_seq: 0,
        }],
        portforwards: Vec::new(),
    });

    let json = serde_json::to_string(&ev).unwrap();
    assert!(json.contains(r#""event":"project.configChanged""#));
    let back: Event = serde_json::from_str(&json).unwrap();
    assert_eq!(back, ev);
}

#[test]
fn task_diff_keeps_the_untracked_split_on_the_wire() {
    let diff = TaskDiff {
        task_id: "t1".into(),
        files: Vec::new(),
        untracked_paths: vec!["new.txt".into()],
        untracked_available: true,
        ignored: vec!["target/app".into()],
        ignored_truncated: false,
        ignored_available: true,
        branch: None,
    };
    let json = serde_json::to_value(&diff).unwrap();
    assert_eq!(json["untrackedPaths"][0], "new.txt");
    assert_eq!(json["untrackedAvailable"], true);
    assert_eq!(json["ignored"][0], "target/app");
    assert_eq!(json["ignoredAvailable"], true);
}

/// Payloads written before `ignored_available` existed must read as
/// "the scan ran" — otherwise old caches would flip "no ignored files"
/// into "scan failed".
#[test]
fn task_diff_without_ignored_available_defaults_to_true() {
    let diff: TaskDiff = serde_json::from_value(serde_json::json!({
        "taskId": "t1",
        "files": [],
        "untrackedPaths": [],
        "untrackedAvailable": true,
        "ignored": [],
    }))
    .unwrap();
    assert!(diff.ignored_available);
}

/// A failed scan must survive the wire as unavailable, not as an empty
/// list — the client shows "unavailable" instead of "no ignored files".
#[test]
fn git_ignored_files_marks_unavailable_on_the_wire() {
    let res = GitIgnoredFiles {
        ignored: Vec::new(),
        truncated: true,
        available: false,
    };
    let json = serde_json::to_value(&res).unwrap();
    assert_eq!(json["available"], false);
    assert_eq!(json["truncated"], true);
    assert!(json["ignored"].as_array().unwrap().is_empty());
}

#[test]
fn response_vs_error_disambiguation() {
    let ok: ServerMessage = serde_json::from_str(r#"{"id":1,"result":{"taskId":"abc"}}"#).unwrap();
    assert!(matches!(ok, ServerMessage::Response { id: 1, .. }));

    let err: ServerMessage =
        serde_json::from_str(r#"{"id":2,"error":{"code":"not_found","message":"no such task"}}"#)
            .unwrap();
    match err {
        ServerMessage::Error { id, error } => {
            assert_eq!(id, 2);
            assert_eq!(error.code, ErrorCode::NotFound);
        }
        other => panic!("expected error, got {other:?}"),
    }
}

#[test]
fn old_daemon_endpoint_defaults_to_external_and_unknown_protocol() {
    let endpoint: DaemonEndpoint = serde_json::from_str(
        r#"{"pid":42,"url":"ws://127.0.0.1:1","token":"t","version":"0.1.0"}"#,
    )
    .unwrap();
    assert_eq!(endpoint.protocol_version, 0);
    assert_eq!(endpoint.owner, DaemonOwner::External);
}
