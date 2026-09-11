//! Helpers shared by the dispatcher topic modules.

use serde_json::json;
use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::daemon::actor::{Command, DaemonHandle};

/// Validate a config YAML into a JSON list of `{ severity, message }` issues.
/// A parse error is reported as a single error-severity issue.
pub(super) fn validate_issues(yaml: &str) -> Vec<serde_json::Value> {
    match crate::bootstrap::validate_config_yaml(yaml) {
        Ok((_, issues)) => issues
            .into_iter()
            .map(|i| {
                let severity = match i.severity {
                    crate::bootstrap::IssueSeverity::Error => "error",
                    crate::bootstrap::IssueSeverity::Warning => "warning",
                };
                json!({ "severity": severity, "message": i.message })
            })
            .collect(),
        Err(e) => vec![json!({ "severity": "error", "message": e })],
    }
}

/// Send a workflow control command and map its `Result<(), String>` reply to
/// an RPC response (`null` on success, `InvalidRequest` with the reason
/// otherwise — e.g. the pipeline is not in the state the control expects).
pub(super) async fn workflow_control(
    handle: &DaemonHandle,
    build: impl FnOnce(oneshot::Sender<Result<(), String>>) -> Command,
) -> Result<serde_json::Value, wire::RpcError> {
    let (tx, rx) = oneshot::channel();
    handle.send(build(tx)).await;
    rx.await
        .unwrap_or_else(|_| Err("daemon closed".into()))
        .map_err(|e| wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message: e,
        })?;
    Ok(json!(null))
}

/// Wire form of one workflow definition for the New Task picker.
pub(super) fn workflow_meta(w: crate::workflow_config::LoadedWorkflow) -> wire::WorkflowMeta {
    let source = match w.source {
        crate::workflow_config::WorkflowSource::Project => wire::WorkflowSource::Project,
        crate::workflow_config::WorkflowSource::Builtin => wire::WorkflowSource::Builtin,
    };
    match w.spec {
        Ok(spec) => wire::WorkflowMeta {
            id: w.id,
            name: spec.name.clone(),
            description: spec.description.clone(),
            source,
            valid: true,
            error: None,
            warnings: w.warnings,
            stages: spec.stage_summary(),
            max_rounds: spec.review.max_rounds,
        },
        Err(error) => wire::WorkflowMeta {
            name: w.id.clone(),
            id: w.id,
            description: None,
            source,
            valid: false,
            error: Some(error),
            warnings: w.warnings,
            stages: vec![],
            max_rounds: 0,
        },
    }
}

/// Resolve a registered project's directory, or an `InvalidRequest` error.
pub(super) async fn project_path(
    handle: &DaemonHandle,
    project: &str,
) -> Result<String, wire::RpcError> {
    handle
        .projects()
        .await
        .into_iter()
        .find(|p| p.name == project)
        .map(|p| p.path)
        .ok_or_else(|| wire::RpcError {
            code: wire::ErrorCode::NotFound,
            message: format!("unknown project '{project}'"),
        })
}

/// Map an anyhow error to a wire `Internal` RPC error.
pub(super) fn rpc_err(e: impl std::fmt::Display) -> wire::RpcError {
    wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: e.to_string(),
    }
}

/// Build a [`BootstrapContext`] by scanning the repo and reading its current
/// config, combined with the wizard answers.
pub(super) fn bootstrap_context(
    project_path: &str,
    answers: wire::BootstrapAnswers,
) -> crate::bootstrap::BootstrapContext {
    use crate::bootstrap::{BootstrapContext, ServiceRuntimeKind, UserRuntimeAnswers};
    let existing = crate::config::find_config_file(std::path::Path::new(project_path));
    let existing_config_yaml = std::fs::read_to_string(&existing).unwrap_or_default();
    let runtime_kind = match answers.runtime_kind.as_str() {
        "docker-compose" => ServiceRuntimeKind::DockerCompose,
        "kubernetes" => ServiceRuntimeKind::Kubernetes,
        "mixed" => ServiceRuntimeKind::Mixed,
        _ => ServiceRuntimeKind::Local,
    };
    BootstrapContext {
        repo_summary: crate::bootstrap::build_repo_summary(project_path),
        existing_config_yaml,
        project_path: project_path.to_string(),
        user_answers: UserRuntimeAnswers {
            agent: answers.agent,
            runtime_kind,
            compose_path: answers.compose_path,
            k8s_manifests_path: answers.k8s_manifests_path,
            k8s_helm_file: answers.k8s_helm_file,
            k8s_release_names: answers.k8s_release_names,
            k8s_namespace: answers.k8s_namespace,
            dev_commands: answers.dev_commands,
            notes: answers.notes,
        },
    }
}

/// Account mutations answer with the whole list, so the client re-renders from
/// one payload instead of patching. A failure is the user's problem to fix
/// (no login found, name taken), so it maps to InvalidRequest, not Internal.
pub(super) fn accounts_result(
    result: Result<Vec<wire::AccountInfo>, String>,
) -> Result<serde_json::Value, wire::RpcError> {
    match result {
        Ok(accounts) => Ok(json!({ "accounts": accounts })),
        Err(message) => Err(wire::RpcError {
            code: wire::ErrorCode::InvalidRequest,
            message,
        }),
    }
}

/// Map a memory-store error onto the wire: scope violations (and the disabled
/// store) are client errors; anything else is an internal failure.
pub(super) fn memory_error(e: crate::daemon::memory::MemoryError) -> wire::RpcError {
    wire::RpcError {
        code: e.code(),
        message: e.message(),
    }
}
