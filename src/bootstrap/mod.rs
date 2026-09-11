use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServiceRuntimeKind {
    Local,
    DockerCompose,
    Kubernetes,
    Mixed,
}

#[derive(Debug, Clone)]
pub struct UserRuntimeAnswers {
    pub agent: String,
    pub runtime_kind: ServiceRuntimeKind,
    pub compose_path: String,
    pub k8s_manifests_path: String,
    pub k8s_helm_file: String,
    pub k8s_release_names: String,
    pub k8s_namespace: String,
    pub dev_commands: String,
    pub notes: String,
}

#[derive(Debug, Clone)]
pub struct BootstrapContext {
    pub repo_summary: String,
    pub existing_config_yaml: String,
    pub user_answers: UserRuntimeAnswers,
    pub project_path: String,
}

#[derive(Debug, Clone)]
pub struct ValidationIssue {
    pub severity: IssueSeverity,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueSeverity {
    Error,
    Warning,
}

mod excerpt;
mod prompt;
mod summary;
mod validate;

#[cfg(test)]
mod tests;

#[cfg(test)]
use excerpt::{
    focused_env_excerpt, focused_helm_excerpt, focused_source_excerpt, redact_env_content,
};
#[cfg(test)]
use summary::runtime_script_name;

pub use prompt::{build_system_prompt, build_user_prompt};
pub use summary::build_repo_summary;
pub use validate::validate_config_yaml;

pub fn extract_yaml_from_response(response: &str) -> String {
    let trimmed = response.trim();
    for marker in ["```yaml", "```yml"] {
        if let Some(start) = trimmed.find(marker) {
            let content = &trimmed[start + marker.len()..];
            if let Some(end) = content.find("```") {
                return content[..end].trim().to_string();
            }
        }
    }

    // Some agents ignore the requested language tag. Prefer an untagged block
    // that at least resembles the expected root schema.
    let mut remainder = trimmed;
    while let Some(start) = remainder.find("```") {
        let content = &remainder[start + 3..];
        let Some(end) = content.find("```") else {
            break;
        };
        let candidate = content[..end].trim();
        if candidate.lines().any(|line| line.starts_with("name:"))
            && candidate.lines().any(|line| line.starts_with("services:"))
        {
            return candidate.to_string();
        }
        remainder = &content[end + 3..];
    }

    trimmed.to_string()
}
