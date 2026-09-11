use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use crate::daemon::acp::rpc::{compact_id, resolve};
use crate::daemon::acp::update::parse_update;
use crate::daemon::acp::{AcpUpdate, PolicyCheck};
use crate::policies::{Phase, PolicyAction, PolicyContext};

use super::permissions::{parse_permission, PendingPerm};
use super::Session;

// Reader: route agent → daemon frames.
pub(super) fn spawn_reader(
    session: Session,
    stdout: tokio::process::ChildStdout,
    policy_tx: Option<mpsc::UnboundedSender<PolicyCheck>>,
    debug: bool,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if debug {
                eprintln!("[acp {} <<] {line}", session.task_id);
            }
            let msg: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => {
                    // Not JSON — likely a framing mismatch (Content-Length?)
                    // or a banner line. Surface it so it's diagnosable.
                    eprintln!("[acp {} <<?] non-JSON line: {line}", session.task_id);
                    continue;
                }
            };

            // Response to one of our requests?
            if msg.get("id").is_some()
                && (msg.get("result").is_some() || msg.get("error").is_some())
                && msg.get("method").is_none()
            {
                if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                    if let Some(tx) = session.pending.lock().unwrap().remove(&id) {
                        let _ = tx.send(msg.clone());
                    }
                }
                continue;
            }

            let Some(method) = msg.get("method").and_then(|m| m.as_str()) else {
                continue;
            };
            let id = msg.get("id").cloned();
            let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));

            match method {
                "session/update" => {
                    match parse_update(&params) {
                        Some(update) => {
                            // Drop transcript replayed during `session/load`
                            // but retain current session metadata, which the
                            // agent is expected to refresh while resuming.
                            if session.replaying.load(Ordering::Acquire)
                                && !matches!(&update, AcpUpdate::Usage { .. })
                            {
                                continue;
                            }
                            let _ = session.updates.send((session.task_id.clone(), update));
                        }
                        None if debug => {
                            eprintln!(
                                "[acp {} <<?] unhandled session/update shape: {params}",
                                session.task_id
                            );
                        }
                        None => {}
                    }
                }
                "session/request_permission" => {
                    let Some(agent_id) = id else { continue };
                    let (title, options, map, tool_call_id) = parse_permission(&params);
                    let request_id = format!(
                        "{}:{}:{}",
                        session.task_id,
                        session.permission_run_id,
                        compact_id(&agent_id)
                    );
                    session.perms.lock().unwrap().insert(
                        request_id.clone(),
                        PendingPerm {
                            agent_id,
                            options: map,
                        },
                    );
                    let _ = session.updates.send((
                        session.task_id.clone(),
                        AcpUpdate::PermissionRequest {
                            request_id,
                            title,
                            options,
                            tool_call_id,
                        },
                    ));
                    // reply is deferred until the human answers
                }
                "fs/read_text_file" => {
                    let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                    let content =
                        std::fs::read_to_string(resolve(&session.cwd, path)).unwrap_or_default();
                    if let Some(id) = id {
                        let _ = session.out_tx.send(
                            json!({"jsonrpc":"2.0","id":id,"result":{"content":content}})
                                .to_string(),
                        );
                    }
                }
                "fs/write_text_file" => {
                    let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
                    let content = params.get("content").and_then(|c| c.as_str()).unwrap_or("");

                    // Check policies before writing.
                    let allowed = if let Some(ref ptx) = policy_tx {
                        let (ptx_reply, ptx_rx) = oneshot::channel();
                        let ctx = PolicyContext {
                            phase: Phase::ToolCall,
                            tool_name: Some("fs/write_text_file".into()),
                            tool_input: Some(json!({"path": path, "content": content})),
                            agent: String::new(), // filled by daemon
                            task_id: session.task_id.clone(),
                            project: String::new(),
                            cwd: PathBuf::from(&session.cwd),
                            labels: HashMap::new(),
                        };
                        let _ = ptx.send(PolicyCheck {
                            ctx,
                            reply: ptx_reply,
                        });
                        match ptx_rx.await {
                            Ok(result) => matches!(result.action, PolicyAction::Allow),
                            Err(_) => true, // policy channel closed — allow
                        }
                    } else {
                        true
                    };

                    if allowed {
                        let _ = std::fs::write(resolve(&session.cwd, path), content);
                        if let Some(id) = id {
                            let _ = session
                                .out_tx
                                .send(json!({"jsonrpc":"2.0","id":id,"result":null}).to_string());
                        }
                    } else {
                        if let Some(id) = id {
                            let _ = session.out_tx.send(
                                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"denied by policy"}}).to_string(),
                            );
                        }
                    }
                }
                _ => {
                    if let Some(id) = id {
                        let _ = session.out_tx.send(
                            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"method not found"}}).to_string(),
                        );
                    }
                }
            }
        }
        session.pending.lock().unwrap().clear();
    });
}
