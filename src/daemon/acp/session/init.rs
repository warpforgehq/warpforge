use std::sync::atomic::Ordering;

use serde_json::{json, Value};
use warpforge_protocol as wire;

use crate::daemon::acp::model::{parse_config_options, resolve_model_apply, ModelApply};
use crate::daemon::acp::process::{acp_error_detail, is_session_gone, sanitize_stderr};
use crate::daemon::acp::rpc::{rpc, rpc_with_exit, RpcOutcome};
use crate::daemon::acp::AcpUpdate;

use super::Session;

pub(super) struct Initialized {
    pub(super) session_id: String,
    pub(super) embedded_context: bool,
    pub(super) image_supported: bool,
}

pub(super) async fn handshake(session: &Session, agent_name: &str) -> Result<Initialized, ()> {
    const INITIALIZE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
    const RPC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
    let mut driver_exit_rx = session.exit_rx.clone();

    let init = match tokio::time::timeout(
        INITIALIZE_TIMEOUT,
        rpc_with_exit(
            &session.out_tx,
            &session.pending,
            &session.next_id,
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true } }
            }),
            &mut driver_exit_rx,
        ),
    )
    .await
    {
        Ok(RpcOutcome::Response(v)) => v,
        Ok(RpcOutcome::Exited(_)) => {
            return Err(());
        }
        Ok(RpcOutcome::TransportClosed) => {
            let stderr = sanitize_stderr(&session.stderr_capture.lock().unwrap());
            let detail = if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(" Pre-initialize stderr: {}", stderr.trim())
            };
            session.reporter.report(format!(
                "Agent command '{agent_name}' closed its ACP stdout before replying to initialize.{detail}"
            ));
            let _ = session.kill_tx.send(());
            return Err(());
        }
        Err(_) => {
            session.reporter.report(format!(
                "Agent command '{agent_name}' is still alive but did not reply to ACP \
                 'initialize' within 60 seconds. Verify that it starts an ACP \
                 JSON-RPC server over stdio."
            ));
            let _ = session.kill_tx.send(());
            return Err(());
        }
    };
    if init.get("error").is_some() {
        session.reporter.report(format!(
            "Agent command '{agent_name}' rejected the ACP initialize request."
        ));
        let _ = session.kill_tx.send(());
        return Err(());
    }
    session.initialized.store(true, Ordering::Release);
    let load_supported = init
        .get("result")
        .and_then(|r| r.get("agentCapabilities"))
        .and_then(|c| c.get("loadSession"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let prompt_caps = init
        .get("result")
        .and_then(|r| r.get("agentCapabilities"))
        .and_then(|c| c.get("promptCapabilities"));
    let image_supported = prompt_caps
        .and_then(|c| c.get("image"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let embedded_context = prompt_caps
        .and_then(|c| c.get("embeddedContext"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    session
        .image_capability
        .store(if image_supported { 2 } else { 1 }, Ordering::Release);
    let _ = session.updates.send((
        session.task_id.clone(),
        AcpUpdate::PromptCapabilities {
            image: image_supported,
            embedded_context,
        },
    ));

    // Resume an existing session (session/load) or start a fresh one
    // (session/new). Resume replays history back as session/update.
    let mut fresh_config_options: Vec<wire::ConfigOption> = Vec::new();
    let session_id = if let Some(ref sid) = session.resume {
        if !load_supported {
            session.reporter.report(format!(
                "Agent command '{agent_name}' does not advertise ACP session/load; \
                 saved session '{sid}' cannot be resumed."
            ));
            let _ = session.kill_tx.send(());
            return Err(());
        }
        // Replay window: the agent streams its whole transcript back
        // between this request and its reply. The reader drops those
        // updates while the flag is set.
        session.replaying.store(true, Ordering::Release);
        let loaded = tokio::time::timeout(
            RPC_TIMEOUT,
            rpc_with_exit(
                &session.out_tx,
                &session.pending,
                &session.next_id,
                "session/load",
                json!({
                    "sessionId": sid, "cwd": session.cwd, "mcpServers": session.mcp_servers
                }),
                &mut driver_exit_rx,
            ),
        )
        .await;
        session.replaying.store(false, Ordering::Release);
        match loaded {
            Ok(RpcOutcome::Response(response)) if response.get("error").is_none() => {
                // The load reply carries the session's current selectors.
                // Emit them so the UI stops showing pre-reconnect values.
                if let Some(result) = response.get("result") {
                    let opts = parse_config_options(result.get("configOptions"));
                    if !opts.is_empty() {
                        fresh_config_options = opts.clone();
                        let _ = session.updates.send((
                            session.task_id.clone(),
                            AcpUpdate::ConfigOptions { options: opts },
                        ));
                    }
                }
                sid.clone()
            }
            Ok(RpcOutcome::Response(response)) => {
                let detail = acp_error_detail(&response);
                let kind =
                    is_session_gone(&response, sid).then_some(wire::TaskBlockedKind::SessionLost);
                session.reporter.report_kind(
                    format!(
                        "Agent command '{agent_name}' rejected ACP session/load for saved \
                         session '{sid}'.{detail}"
                    ),
                    kind,
                );
                let _ = session.kill_tx.send(());
                return Err(());
            }
            Ok(RpcOutcome::Exited(_)) => return Err(()),
            Ok(RpcOutcome::TransportClosed) => {
                session.reporter.report(format!(
                    "Agent command '{agent_name}' closed its ACP stdout during session/load for saved session '{sid}'."
                ));
                let _ = session.kill_tx.send(());
                return Err(());
            }
            Err(_) => {
                session.reporter.report(format!(
                    "Agent command '{agent_name}' did not complete ACP session/load \
                     for saved session '{sid}' within 15 seconds."
                ));
                let _ = session.kill_tx.send(());
                return Err(());
            }
        }
    } else {
        match tokio::time::timeout(
            RPC_TIMEOUT,
            rpc_with_exit(
                &session.out_tx,
                &session.pending,
                &session.next_id,
                "session/new",
                json!({
                    "cwd": session.cwd, "mcpServers": session.mcp_servers
                }),
                &mut driver_exit_rx,
            ),
        )
        .await
        {
            Ok(RpcOutcome::Response(v)) => {
                if v.get("error").is_some() {
                    let detail = acp_error_detail(&v);
                    session.reporter.report(format!(
                        "Agent command '{agent_name}' rejected the ACP session/new request.{detail}"
                    ));
                    let _ = session.kill_tx.send(());
                    return Err(());
                }
                // Model/mode selectors the agent advertises up-front.
                if let Some(result) = v.get("result") {
                    let opts = parse_config_options(result.get("configOptions"));
                    if !opts.is_empty() {
                        fresh_config_options = opts.clone();
                        let _ = session.updates.send((
                            session.task_id.clone(),
                            AcpUpdate::ConfigOptions { options: opts },
                        ));
                    }
                }
                let Some(session_id) = v
                    .get("result")
                    .and_then(|r| r.get("sessionId"))
                    .and_then(|s| s.as_str())
                    .map(String::from)
                else {
                    session.reporter.report(format!(
                        "Agent command '{agent_name}' returned no session ID from ACP \
                         session/new."
                    ));
                    let _ = session.kill_tx.send(());
                    return Err(());
                };
                session_id
            }
            Ok(RpcOutcome::Exited(_)) => return Err(()),
            Ok(RpcOutcome::TransportClosed) => {
                session.reporter.report(format!(
                    "Agent command '{agent_name}' closed its ACP stdout during session/new."
                ));
                let _ = session.kill_tx.send(());
                return Err(());
            }
            Err(_) => {
                session.reporter.report(format!(
                    "Agent command '{agent_name}' did not reply to ACP session/new \
                     within 15 seconds."
                ));
                let _ = session.kill_tx.send(());
                return Err(());
            }
        }
    };

    // Apply the user's model intent before the first prompt — on a
    // fresh session and, when the task carries an explicit intent, on
    // resume too (a daemon restart lands here invisibly, and the agent
    // would otherwise silently keep whatever model it loaded with).
    // With no intent a resume keeps the loaded session's model state,
    // exactly as before. See resolve_model_apply for the decision.
    match resolve_model_apply(session.default_model.as_deref(), &fresh_config_options) {
        ModelApply::Keep => {}
        ModelApply::UnknownSelector => {
            eprintln!(
                "[daemon] requested model '{}': no model selector advertised yet, \
                 leaving the session's own model untouched",
                session.default_model.as_deref().unwrap_or("")
            );
        }
        ModelApply::Set {
            ref config_id,
            ref value,
        } => {
            let set_res = tokio::time::timeout(
                RPC_TIMEOUT,
                rpc(
                    &session.out_tx,
                    &session.pending,
                    &session.next_id,
                    "session/set_config_option",
                    json!({
                        "sessionId": session_id,
                        "configId": config_id,
                        "value": value,
                    }),
                ),
            )
            .await;
            match set_res {
                Ok(Some(resp)) if resp.get("error").is_none() => {
                    if let Some(result) = resp.get("result") {
                        let opts = parse_config_options(result.get("configOptions"));
                        if !opts.is_empty() {
                            let _ = session.updates.send((
                                session.task_id.clone(),
                                AcpUpdate::ConfigOptions { options: opts },
                            ));
                        }
                    }
                }
                Ok(Some(resp)) => {
                    let message = format!(
                        "Requested model '{value}' was not applied: the agent \
                         rejected it.{}",
                        acp_error_detail(&resp)
                    );
                    eprintln!("[daemon] {message}");
                    let _ = session.updates.send((
                        session.task_id.clone(),
                        AcpUpdate::ModelMismatch { message },
                    ));
                }
                Ok(None) => {
                    let message = format!(
                        "Requested model '{value}' was not applied: the agent \
                         connection closed."
                    );
                    eprintln!("[daemon] {message}");
                    let _ = session.updates.send((
                        session.task_id.clone(),
                        AcpUpdate::ModelMismatch { message },
                    ));
                }
                Err(_) => {
                    let message = format!(
                        "Requested model '{value}' was not applied: the agent \
                         did not answer within {}s.",
                        RPC_TIMEOUT.as_secs()
                    );
                    eprintln!("[daemon] {message}");
                    let _ = session.updates.send((
                        session.task_id.clone(),
                        AcpUpdate::ModelMismatch { message },
                    ));
                }
            }
        }
    }

    // Apply non-model config overrides (reasoning effort, mode, etc.)
    // the user picked in the "New task" dialog. Unknown option ids are
    // logged and skipped — never abort session startup.
    if session.resume.is_none() {
        for (opt_id, opt_value) in &session.config_overrides {
            let set_res = tokio::time::timeout(
                RPC_TIMEOUT,
                rpc(
                    &session.out_tx,
                    &session.pending,
                    &session.next_id,
                    "session/set_config_option",
                    json!({
                        "sessionId": session_id,
                        "configId": opt_id,
                        "value": opt_value,
                    }),
                ),
            )
            .await;
            match set_res {
                Ok(Some(resp)) if resp.get("error").is_none() => {
                    if let Some(result) = resp.get("result") {
                        let opts = parse_config_options(result.get("configOptions"));
                        if !opts.is_empty() {
                            let _ = session.updates.send((
                                session.task_id.clone(),
                                AcpUpdate::ConfigOptions { options: opts },
                            ));
                        }
                    }
                }
                Ok(Some(resp)) => {
                    eprintln!(
                        "[daemon] config override '{}' rejected by agent: {}",
                        opt_id,
                        acp_error_detail(&resp)
                    );
                }
                Ok(None) => {
                    eprintln!("[daemon] config override '{}': transport closed", opt_id);
                }
                Err(_) => {
                    eprintln!("[daemon] config override '{}': RPC timed out", opt_id);
                }
            }
        }
    }

    let _ = session.updates.send((
        session.task_id.clone(),
        AcpUpdate::SessionStarted {
            session_id: session_id.clone(),
        },
    ));

    Ok(Initialized {
        session_id,
        embedded_context,
        image_supported,
    })
}
