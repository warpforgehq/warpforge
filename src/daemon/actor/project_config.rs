use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;
use warpforge_protocol as wire;

use crate::config::{
    find_config_file, load_local, load_shared, read_config_text, resolve_config_path,
    WorkspaceConfig,
};
use crate::config_local::{local_config_path, merge_text};

use super::{Daemon, DaemonHandle};

pub(crate) enum ProjectConfigCommand {
    Read {
        project: String,
        reply: oneshot::Sender<Result<Value, wire::RpcError>>,
    },
    Write {
        request: wire::ProjectConfigWrite,
        reply: oneshot::Sender<Result<Value, wire::RpcError>>,
    },
}

impl DaemonHandle {
    pub(crate) async fn read_project_config(
        &self,
        project: String,
    ) -> Result<Value, wire::RpcError> {
        let (reply, response) = oneshot::channel();
        self.send(super::Command::ProjectConfig(ProjectConfigCommand::Read {
            project,
            reply,
        }))
        .await;
        response.await.map_err(internal)?
    }

    pub(crate) async fn write_project_config(
        &self,
        request: wire::ProjectConfigWrite,
    ) -> Result<Value, wire::RpcError> {
        let (reply, response) = oneshot::channel();
        self.send(super::Command::ProjectConfig(ProjectConfigCommand::Write {
            request,
            reply,
        }))
        .await;
        response.await.map_err(internal)?
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ConfigFiles {
    shared: ConfigFile,
    local: ConfigFile,
}

#[derive(Debug, PartialEq, Eq)]
struct ConfigFile {
    path: PathBuf,
    contents: Result<Option<String>, String>,
}

impl ConfigFile {
    fn read(root: &Path, path: PathBuf) -> Self {
        let contents = read_config_text(root, &path).map_err(|e| format!("{e:#}"));
        Self { path, contents }
    }

    fn text(&self) -> Result<Option<&str>> {
        self.contents
            .as_ref()
            .map(|text| text.as_deref())
            .map_err(|error| anyhow::anyhow!("{error}"))
    }

    fn fingerprint(&self) -> Result<Option<String>> {
        Ok(self.text()?.map(|text| fingerprint(&self.path, text)))
    }

    fn view(&self) -> Result<wire::ConfigFile> {
        let text = self.text()?;
        Ok(wire::ConfigFile {
            path: self.path.display().to_string(),
            exists: text.is_some(),
            text: text.unwrap_or_default().to_string(),
            fingerprint: self.fingerprint()?,
        })
    }
}

impl ConfigFiles {
    pub(super) fn read(root: &Path) -> Self {
        let shared = find_config_file(root);
        let local = local_config_path(&shared);
        Self {
            shared: ConfigFile::read(root, shared),
            local: ConfigFile::read(root, local),
        }
    }

    pub(super) fn load(
        &self,
        root: &Path,
        project: &str,
    ) -> Result<Option<WorkspaceConfig>, wire::ConfigError> {
        let shared_error = |error| diagnostic(&self.shared.path, error);
        let shared_text = self.shared.text().map_err(shared_error)?;
        let shared = load_shared(root, &self.shared.path, shared_text).map_err(shared_error)?;
        let mut config = load_local(
            root,
            &self.local.path,
            shared_text,
            shared,
            self.local.text(),
        );
        if let Some(config) = &mut config {
            config.name.get_or_insert_with(|| project.to_string());
        }
        Ok(config)
    }

    fn target(&self, scope: wire::ConfigScope) -> &ConfigFile {
        match scope {
            wire::ConfigScope::Shared => &self.shared,
            wire::ConfigScope::Local => &self.local,
        }
    }

    fn validate(
        &self,
        root: &Path,
        scope: wire::ConfigScope,
        text: &str,
    ) -> Result<(), wire::RpcError> {
        let (shared_text, local_text) = match scope {
            wire::ConfigScope::Shared => (Some(text), self.local.text().map_err(internal)?),
            wire::ConfigScope::Local => (self.shared.text().map_err(internal)?, Some(text)),
        };
        let shared = load_shared(root, &self.shared.path, shared_text).map_err(invalid)?;
        if let Some(local) = local_text {
            let relative = self
                .local
                .path
                .strip_prefix(root)
                .unwrap_or(&self.local.path);
            merge_text(relative, shared_text, shared.as_ref(), local)
                .with_context(|| format!("validating {}", relative.display()))
                .map_err(invalid)?;
        }
        Ok(())
    }
}

impl Daemon {
    pub(super) async fn handle_project_config_command(&mut self, command: ProjectConfigCommand) {
        match command {
            ProjectConfigCommand::Read { project, reply } => {
                let _ = reply.send(self.read_project_config(&project).await);
            }
            ProjectConfigCommand::Write { request, reply } => {
                let _ = reply.send(self.write_project_config(request).await);
            }
        }
    }

    async fn read_project_config(&mut self, project: &str) -> Result<Value, wire::RpcError> {
        let root = self.config_root(project)?;
        let cached = self.config_observer.config(project).cloned();
        let project = project.to_string();
        tokio::task::spawn_blocking(move || {
            let files = ConfigFiles::read(&root);
            let (config, error) = match files.load(&root, &project) {
                Ok(config) => (config, None),
                Err(error) => (cached, Some(error)),
            };
            let config = config.unwrap_or_default();
            Ok(json!({
                "shared": files.shared.view().map_err(internal)?,
                "local": files.local.view().map_err(internal)?,
                "configError": error,
                "localConfigError": config.local_error,
                "effective": {
                    "name": config.name.as_deref().unwrap_or(&project),
                    "services": config.services,
                    "worktree": config.worktree,
                    "ports": config.ports,
                    "portforwards": config.portforwards,
                    "linked": config.linked,
                    "localFields": config.local.fields
                }
            }))
        })
        .await
        .map_err(internal)?
    }

    async fn write_project_config(
        &mut self,
        request: wire::ProjectConfigWrite,
    ) -> Result<Value, wire::RpcError> {
        let root = self.config_root(&request.project)?;
        let project = request.project.clone();
        let (fingerprint, files) = tokio::task::spawn_blocking(move || {
            let fingerprint = save(&root, &request)?;
            Ok((fingerprint, ConfigFiles::read(&root)))
        })
        .await
        .map_err(internal)??;
        self.apply_config_files(&project, files).await;
        Ok(json!({ "fingerprint": fingerprint }))
    }

    fn config_root(&self, project: &str) -> Result<PathBuf, wire::RpcError> {
        self.project_path(project)
            .map(PathBuf::from)
            .ok_or_else(|| wire::RpcError {
                code: wire::ErrorCode::NotFound,
                message: format!("unknown project {project:?}"),
            })
    }
}

fn save(root: &Path, request: &wire::ProjectConfigWrite) -> Result<String, wire::RpcError> {
    let files = ConfigFiles::read(root);
    let file = files.target(request.scope);
    let base = file.fingerprint().map_err(internal)?;
    if request.base != base {
        return Err(changed(base));
    }
    files.validate(root, request.scope, &request.text)?;
    let target = resolve_config_path(root, &file.path).map_err(internal)?;
    let parent = target
        .parent()
        .context("config path has no parent")
        .map_err(internal)?;
    let other = files.target(match request.scope {
        wire::ConfigScope::Shared => wire::ConfigScope::Local,
        wire::ConfigScope::Local => wire::ConfigScope::Shared,
    });
    let other_target = resolve_config_path(root, &other.path).map_err(internal)?;
    if target == other_target {
        return Err(internal("shared and local config resolve to the same file"));
    }
    fs::create_dir_all(parent).map_err(internal)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(internal)?;
    temp.write_all(request.text.as_bytes()).map_err(internal)?;
    if base.is_some() {
        temp.as_file()
            .set_permissions(fs::metadata(&target).map_err(internal)?.permissions())
            .map_err(internal)?;
    }
    let current = ConfigFiles::read(root);
    if current != files
        || resolve_config_path(root, &file.path).map_err(internal)? != target
        || resolve_config_path(root, &other.path).map_err(internal)? != other_target
    {
        return Err(changed(
            current
                .target(request.scope)
                .fingerprint()
                .map_err(internal)?,
        ));
    }
    if base.is_some() {
        temp.persist(&target).map_err(internal)?;
    } else if let Err(error) = temp.persist_noclobber(&target) {
        if error.error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(internal(error));
        }
        let current = ConfigFiles::read(root);
        return Err(changed(
            current
                .target(request.scope)
                .fingerprint()
                .map_err(internal)?,
        ));
    }
    Ok(fingerprint(&file.path, &request.text))
}

fn fingerprint(path: &Path, text: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(path.as_os_str().as_encoded_bytes());
    hash.update([0]);
    hash.update(text.as_bytes());
    format!("{:x}", hash.finalize())
}

fn diagnostic(file: &Path, error: anyhow::Error) -> wire::ConfigError {
    let location = error
        .downcast_ref::<serde_yaml::Error>()
        .and_then(serde_yaml::Error::location);
    wire::ConfigError {
        file: file.display().to_string(),
        line: location.as_ref().map(serde_yaml::Location::line),
        column: location.as_ref().map(serde_yaml::Location::column),
        message: format!("{error:#}"),
    }
}

fn invalid(error: anyhow::Error) -> wire::RpcError {
    let detail = diagnostic(Path::new(""), error);
    wire::RpcError {
        code: wire::ErrorCode::ConfigInvalid {
            line: detail.line,
            column: detail.column,
        },
        message: detail.message,
    }
}

fn changed(fingerprint: Option<String>) -> wire::RpcError {
    wire::RpcError {
        code: wire::ErrorCode::ConfigChanged { fingerprint },
        message: "Project config changed on disk".into(),
    }
}

fn internal(error: impl std::fmt::Display) -> wire::RpcError {
    wire::RpcError {
        code: wire::ErrorCode::Internal,
        message: error.to_string(),
    }
}
