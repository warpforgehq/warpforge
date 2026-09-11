//! Server dispatcher topic: project.

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::util::{bootstrap_context, project_path, validate_issues};
use serde_json::json;
use warpforge_protocol as wire;

pub(super) async fn project_add(
    handle: &DaemonHandle,
    path: String,
    name: Option<String>,
    port_range: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let parsed = match port_range.as_deref().map(crate::config::parse_range) {
        None => None,
        Some(Some((start, end))) => Some(crate::registry::PortRange {
            start,
            size: end - start + 1,
        }),
        // `Some(None)` = a range string was supplied but invalid.
        Some(None) => {
            return Err(wire::RpcError {
                code: wire::ErrorCode::InvalidRequest,
                message: format!(
                    "invalid port range {:?}: expected \"4200\" or \"4200-4299\"",
                    port_range.unwrap_or_default()
                ),
            });
        }
    };
    let entry = handle
        .add_project(&path, name.as_deref(), parsed)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: e,
        })?;
    Ok(json!({ "name": entry.name, "path": entry.path }))
}

pub(super) async fn project_remove(
    handle: &DaemonHandle,
    name: String,
    stop_resources: bool,
) -> Result<serde_json::Value, wire::RpcError> {
    handle
        .remove_project(&name, stop_resources)
        .await
        .map_err(|error| {
            let code = match error {
                crate::daemon::actor::ProjectRemovalError::Conflict(_) => wire::ErrorCode::Conflict,
                crate::daemon::actor::ProjectRemovalError::NotFound(_) => wire::ErrorCode::NotFound,
                crate::daemon::actor::ProjectRemovalError::Internal(_) => wire::ErrorCode::Internal,
            };
            wire::RpcError {
                code,
                message: error.to_string(),
            }
        })?;
    Ok(json!(null))
}

pub(super) async fn project_set_port_range(
    handle: &DaemonHandle,
    project: String,
    range: Option<String>,
) -> Result<serde_json::Value, wire::RpcError> {
    let parsed = match range.as_deref().map(crate::config::parse_range) {
        None => None,
        Some(Some((start, end))) => Some(crate::registry::PortRange {
            start,
            size: end - start + 1,
        }),
        // `Some(None)` = a range string was supplied but invalid.
        Some(None) => {
            return Err(wire::RpcError {
                code: wire::ErrorCode::InvalidRequest,
                message: format!(
                    "invalid port range {:?}: expected \"4200\" or \"4200-4299\"",
                    range.unwrap_or_default()
                ),
            });
        }
    };
    handle
        .set_port_range(&project, parsed)
        .await
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: e,
        })?;
    Ok(json!(null))
}

pub(super) async fn bootstrap_start(
    handle: &DaemonHandle,
    project: String,
    answers: wire::BootstrapAnswers,
) -> Result<serde_json::Value, wire::RpcError> {
    let path = project_path(handle, &project).await?;
    let ctx = bootstrap_context(&path, answers);
    let system_prompt = crate::bootstrap::build_system_prompt(&ctx);
    let user_prompt = crate::bootstrap::build_user_prompt(&ctx);
    let prompt = format!("## System Context\n\n{system_prompt}\n\n---\n\n## Task\n\n{user_prompt}");
    let id = handle
        .create_task(
            &project,
            &prompt,
            &ctx.user_answers.agent,
            vec!["bootstrap".into(), "config-gen".into()],
            false,
            false,
            None,
            Vec::new(),
            None,
            std::collections::HashMap::new(),
            None,
        )
        .await;
    Ok(json!({ "taskId": id }))
}

pub(super) async fn bootstrap_finalize(
    response: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let yaml = crate::bootstrap::extract_yaml_from_response(&response);
    let issues = validate_issues(&yaml);
    Ok(json!({ "yaml": yaml, "issues": issues }))
}

pub(super) async fn bootstrap_read_config(
    handle: &DaemonHandle,
    project: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let path = project_path(handle, &project).await?;
    let target = crate::config::find_config_file(std::path::Path::new(&path));
    let yaml = std::fs::read_to_string(&target).unwrap_or_default();
    let issues = validate_issues(&yaml);
    Ok(json!({ "yaml": yaml, "issues": issues }))
}

pub(super) async fn bootstrap_write_config(
    handle: &DaemonHandle,
    project: String,
    yaml: String,
) -> Result<serde_json::Value, wire::RpcError> {
    let path = project_path(handle, &project).await?;
    let target = crate::config::find_config_file(std::path::Path::new(&path));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| wire::RpcError {
            code: wire::ErrorCode::Internal,
            message: format!("create {}: {e}", parent.display()),
        })?;
    }
    std::fs::write(&target, yaml).map_err(|e| wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: format!("write {}: {e}", target.display()),
    })?;
    Ok(json!({ "ok": true, "path": target.to_string_lossy() }))
}
