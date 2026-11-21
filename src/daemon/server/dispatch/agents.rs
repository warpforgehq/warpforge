//! Server dispatcher topic: agents.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::accounts_result;
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn text_generate(
    handle: &DaemonHandle,
    task_id: String,
    agent_id: String,
    kind: wire::TextGenKind,
    model: Option<String>,
    account_id: Option<String>,
    input: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let text = handle
        .generate_text(&task_id, &agent_id, kind, model, account_id, input)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    Ok(json!({ "text": text }))
}

pub(super) async fn text_enhance(
    handle: &DaemonHandle,
    project: String,
    agent_id: String,
    prompt: String,
    model: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let text = handle
        .enhance_text(&project, &agent_id, &prompt, model)
        .await
        .map_err(|message| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message,
        })?;
    Ok(json!({ "text": text }))
}

pub(super) async fn agents_detect(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let detected = handle.detect_agents().await;
    serde_json::to_value(detected).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    })
}

pub(super) async fn agents_update(
    handle: &DaemonHandle,
    agents: Vec<wire::AgentConfig>,
) -> Result<serde_json::Value, wire::RpcError> {
    handle.update_agents(agents).await;
    Ok(json!(null))
}

fn sign_in_error(message: String) -> wire::RpcError {
    wire::RpcError {
        code: wire::ErrorCode::Internal,
        message,
    }
}

async fn sign_in_context(
    handle: &DaemonHandle,
    id: &str,
) -> Result<crate::daemon::actor::AgentProbeContext, wire::RpcError> {
    if id != "antigravity" {
        return Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: format!("agent '{id}' has no sign-in in Warpforge"),
        });
    }
    handle
        .agent_probe_context(id)
        .await
        .ok_or_else(|| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: format!("unknown agent '{id}'"),
        })
}

pub(super) async fn agents_sign_in_start(
    handle: &DaemonHandle,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let context = sign_in_context(handle, &id).await?;
    let url =
        crate::daemon::agents::start_sign_in(&context.acp_command, &context.cwd, &context.env)
            .await
            .map_err(sign_in_error)?;
    Ok(json!({ "url": url }))
}

pub(super) async fn agents_sign_in_finish(
    handle: &DaemonHandle,
    id: String,
    code: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let context = sign_in_context(handle, &id).await?;
    crate::daemon::agents::finish_sign_in(&code)
        .await
        .map_err(sign_in_error)?;
    let verified = crate::daemon::agent_probe::probe_models(
        &context.acp_command,
        &context.cwd,
        &context.env.set,
        &context.env.remove,
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string());
    handle.observe_agent_health(&id, verified.clone()).await;
    Ok(json!({
        "verified": verified.is_ok(),
        "verifyError": verified.err(),
    }))
}

pub(super) async fn agents_install(
    handle: &DaemonHandle,
    id: String,
    clean: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    use crate::daemon::agents::{install_agent, InstallError, InstallRequest};

    let Some(context) = handle.agent_probe_context(&id).await else {
        return Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: format!("unknown agent '{id}'"),
        });
    };
    let is_default_command = crate::daemon::agents::known_agent(&id)
        .is_some_and(|agent| agent.default_acp_command == context.acp_command);
    let request = InstallRequest {
        id: &id,
        clean,
        acp_command: &context.acp_command,
        is_default_command,
        cwd: &context.cwd,
        env: &context.env,
    };
    let outcome = match install_agent(request).await {
        Ok(outcome) => outcome,
        Err(InstallError::InFlight) => {
            return Err(wire::RpcError {
                code: wire::ErrorCode::Conflict,
                message: format!("an install for agent '{id}' is already running"),
            })
        }
        Err(InstallError::NoCommand) => {
            return Err(wire::RpcError {
                code: wire::ErrorCode::InvalidRequest,
                message: format!("no automated install/update available for agent '{id}'"),
            })
        }
    };
    // Keep the agent's tracked health in step with what this install just
    // proved, so Settings does not keep showing a mark this install fixed (or
    // miss one a failed install just confirmed).
    handle
        .observe_agent_health(
            &id,
            if outcome.verified {
                Ok(())
            } else {
                Err(outcome.verify_error.clone().unwrap_or_default())
            },
        )
        .await;
    Ok(json!({
        "ok": outcome.ok,
        "command": outcome.command,
        "output": outcome.output,
        "verified": outcome.verified,
        "verifyError": outcome.verify_error,
        "summary": outcome.summary,
        "brokenInstall": outcome.broken_install,
        "repaired": outcome.repaired,
    }))
}

pub(super) async fn agents_probe(
    handle: &DaemonHandle,
    id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .probe_agent(&id)
        .await
        .map(|()| json!(null))
        .map_err(|message| {
            // A broken install is a distinct code, and the row shows the one
            // line naming the failure rather than a Node stack trace.
            if crate::daemon::agents::broken_install(&message) {
                wire::RpcError {
                    code: wire::ErrorCode::AgentBrokenInstall,
                    message: crate::daemon::agents::broken_install_summary(&message)
                        .unwrap_or(message),
                }
            } else {
                wire::RpcError {
                    code: wire::ErrorCode::InvalidRequest,
                    message,
                }
            }
        })
}

pub(super) async fn agents_list(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let snapshot = handle.snapshot().await;
    Ok(json!({ "agents": snapshot.agents }))
}

pub(super) async fn accounts_list(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    Ok(json!({ "accounts": handle.list_accounts().await }))
}

pub(super) async fn accounts_import(
    handle: &DaemonHandle,
    agent_id: String,
    label: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.import_account(agent_id, label).await)
}

pub(super) async fn accounts_rename(
    handle: &DaemonHandle,
    account_id: String,
    label: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.rename_account(account_id, label).await)
}

pub(super) async fn accounts_remove(
    handle: &DaemonHandle,
    account_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.remove_account(account_id).await)
}

pub(super) async fn list_agent_limits(
    handle: &DaemonHandle,
    refresh: Option<bool>,
) -> Result<serde_json::Value, wire::RpcError> {
    let accounts = handle.list_agent_limits(refresh.unwrap_or(false)).await;
    Ok(json!({ "accounts": accounts }))
}

pub(super) async fn list_agent_spend(
    handle: &DaemonHandle,
) -> Result<serde_json::Value, wire::RpcError> {
    let agents = handle.list_agent_spend().await;
    Ok(json!({ "agents": agents }))
}

pub(super) async fn accounts_set_active(
    handle: &DaemonHandle,
    agent_id: String,
    account_id: String,
) -> Result<serde_json::Value, wire::RpcError> {
    accounts_result(handle.set_active_account(agent_id, account_id).await)
}
