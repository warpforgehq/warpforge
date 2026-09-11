use std::path::Path;

use super::excerpt::{focused_helm_excerpt, truncate_file_content};
use super::validate::validate_config_yaml;
use super::{BootstrapContext, IssueSeverity, ServiceRuntimeKind};

// ── Prompt Builders ───────────────────────────────────────────────────────────

pub fn build_system_prompt(ctx: &BootstrapContext) -> String {
    let runtime_desc = match ctx.user_answers.runtime_kind {
        ServiceRuntimeKind::DockerCompose => "Use `docker compose` commands for containers.",
        ServiceRuntimeKind::Kubernetes => {
            "Put local app processes in `services` and Kubernetes dependencies in `portforwards`."
        }
        ServiceRuntimeKind::Mixed => {
            "Put local processes and Docker Compose commands in `services`; put Kubernetes dependencies in `portforwards`."
        }
        ServiceRuntimeKind::Local => "Use local development processes such as package scripts, servers, and workers.",
    };

    let dev_cmds: String = ctx
        .user_answers
        .dev_commands
        .split([',', '\n'])
        .map(|c| format!("- {}", c.trim()))
        .filter(|c| !c.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    let notes = if ctx.user_answers.notes.is_empty() {
        "(none)"
    } else {
        &ctx.user_answers.notes
    };

    format!(
        r#"Create one valid Warpforge YAML configuration from repository evidence and the user's answers.

Runtime: {runtime_desc}
User-supplied commands:
{dev_cmds}
User notes: {notes}

Runtime facts:
- `service.port` is the app's real/default listening port from its code or config, not a requested Warpforge runtime-port number. A nonzero value enables managed allocation: Warpforge chooses a free port in the project's 100-port range, injects it as `PORT`, and resolves `${{service.port}}` references. Use it only when the process honors `PORT` directly or through its command.
- Repeated `service.port` defaults are allowed because each service receives its own allocated runtime port. Do not renumber services merely to make declared defaults unique.
- A declared service-port default does not reserve that exact runtime port and may equal a fixed port-forward localPort. Never omit `service.port` merely because the same number appears elsewhere; allocation avoids the collision.
- Warpforge interpolates `${{other-service.port}}` only inside a service's YAML `env`. It does not rewrite repository `.env*` files. Override localhost URLs there when one local service consumes another dynamically allocated service.
- `portforwards[].localPort` is fixed and must be unique among port-forwards. Warpforge runs and restarts `kubectl port-forward`; never put `kubectl` in a service command.
- `readyPattern` is a case-sensitive literal substring matched against stdout or stderr, not a regex. Use a stable fragment emitted only after initialization.
- `dependsOn` may reference service names or named port-forwards.
- Workers and consumers are long-running services. Omit `port` unless they listen; depend on their broker/database and use an initialization-log `readyPattern` when one exists.
- The schema has no variant condition. Include clearly named services for each requested variant and add short YAML comments; never invent conditional fields.
- Treat files explicitly named in user notes as primary evidence: inspect them with repository tools before deciding services, ports, or dependencies.

Write the result to `.warpforge.yaml` in the repository root, then output the exact file contents with no Markdown fence or explanation. Do not guess commands, ports, Kubernetes names, or dependencies; omit unsupported optional fields and preserve useful existing values when evidence is inconclusive.
"#
    )
}

pub fn build_user_prompt(ctx: &BootstrapContext) -> String {
    let existing_config = truncate_file_content(&ctx.existing_config_yaml, 12_000);
    let existing_status = match validate_config_yaml(&ctx.existing_config_yaml) {
        Ok((_, issues))
            if issues
                .iter()
                .all(|issue| issue.severity != IssueSeverity::Error) =>
        {
            "Existing config is parseable. Preserve only fields supported by repository evidence."
        }
        _ => "Existing config is invalid migration input. Use it only as hints; do not copy unsupported shapes or fields.",
    };
    let service_scope = match ctx.user_answers.runtime_kind {
        ServiceRuntimeKind::DockerCompose => {
            "Add relevant local apps and Docker Compose services. Do not add Kubernetes port-forwards unless the user explicitly requests them."
        }
        ServiceRuntimeKind::Kubernetes => {
            "Add relevant local app processes and Kubernetes port-forwards. Do not add Docker Compose services unless the user explicitly requests them."
        }
        ServiceRuntimeKind::Mixed => {
            "Add relevant local app processes, requested Docker Compose services, and supported Kubernetes port-forwards."
        }
        ServiceRuntimeKind::Local => {
            "Add relevant local app processes. Do not add Docker Compose services or Kubernetes port-forwards unless the user explicitly requests them."
        }
    };
    let mut prompt = format!(
        r#"Repository root: {project_path}

Repository summary:
{repo_summary}

{existing_status}
{existing_config}

Schema (exact field names and shapes):

```yaml
name: <project-name>
services:                         # MAP, never a list
  <service-name>:
    command: <shell command>      # required; runs from repository root
    port: <number>                # optional; normal/default port; process must honor injected PORT
    readyPattern: <literal text>  # optional; case-sensitive log substring
    dependsOn: [<name>, ...]      # optional; service or named port-forward
    env:
      KEY: value
portforwards:                     # LIST, never a map
  - name: <label>
    namespace: <k8s namespace>
    pod: <pod name or prefix>
    localPort: <fixed localhost port>
    remotePort: <pod port>
```

Discovery checklist:
1. Find dev/start/worker commands in every workspace package.json, Makefile, Procfile, Compose file, Cargo metadata, and framework config. Prefer the repository's package-manager/filter syntax.
2. Trace ports from PORT/*_PORT defaults, listen(...)/bind(...), CLI --port, Compose mappings, Vite server.port, and .env.example. A hard-coded listener that ignores PORT is not safely managed: omit port rather than inventing a value.
3. Find readiness text in the log statement after listen/startup, framework startup output, or known command output. Copy a distinctive literal fragment such as "Local:" or "Listening on"; do not use regex syntax. Omit it if no reliable line exists.
4. Inspect `.env*` localhost URLs. When they point to another dynamically allocated local service, override that variable in YAML `env` with `${{service-name.port}}`; use literal ports for fixed port-forwards. Do not assume Warpforge edits repository env files.
5. {service_scope} Include runnable apps supported by root dev scripts, runtime manifests, or user answers; a package-level `dev` script alone is not proof that a demo, theme, or tool belongs in the workspace. Give every referenced port-forward a unique name and fixed localPort.
6. For every managed service port, trace all localhost consumers and override their URLs in YAML `env` with `${{service-name.port}}`. Do not keep a provider on a fixed default merely because a consumer's repository env uses that number.
7. Build acyclic dependsOn chains. Workers normally depend on brokers/databases and have no port. Do not model a remote dependency both as a service and a port-forward.

Before writing, verify the file against the schema above and the repository evidence.

Create or update `.warpforge.yaml`, then return its complete contents only. Keep proven useful fields from the current config; remove invalid or unsupported fields. Before responding, parse-check the file, verify services is a map and portforwards is a list, verify every dependency exists, verify the service graph is acyclic, and verify fixed port-forward local ports are unique.
"#,
        project_path = ctx.project_path,
        repo_summary = ctx.repo_summary,
        existing_status = existing_status,
        existing_config = existing_config,
        service_scope = service_scope,
    );

    let compose_runtime = matches!(
        ctx.user_answers.runtime_kind,
        ServiceRuntimeKind::DockerCompose | ServiceRuntimeKind::Mixed
    );
    if compose_runtime && !ctx.user_answers.compose_path.is_empty() {
        append_file_context(
            &mut prompt,
            "Docker Compose file",
            ctx,
            &ctx.user_answers.compose_path,
            8_000,
        );
    }

    let kubernetes_runtime = matches!(
        ctx.user_answers.runtime_kind,
        ServiceRuntimeKind::Kubernetes | ServiceRuntimeKind::Mixed
    );
    if kubernetes_runtime {
        if !ctx.user_answers.k8s_helm_file.is_empty() {
            append_file_context(
                &mut prompt,
                "Helm chart/values file",
                ctx,
                &ctx.user_answers.k8s_helm_file,
                3_000,
            );
        }
        if !ctx.user_answers.k8s_release_names.is_empty() {
            prompt.push_str(&format!(
                "\nKubernetes release/service names: {}\n",
                ctx.user_answers.k8s_release_names
            ));
        }
        if !ctx.user_answers.k8s_namespace.is_empty() {
            prompt.push_str(&format!(
                "\nKubernetes namespace: {}\n",
                ctx.user_answers.k8s_namespace
            ));
        }
        if !ctx.user_answers.k8s_manifests_path.is_empty() {
            let manifests_dir = resolve_user_path(ctx, &ctx.user_answers.k8s_manifests_path);
            prompt.push_str(&format!(
                "\nKubernetes manifests directory: {}\n",
                manifests_dir.display()
            ));
            if let Ok(read) = manifests_dir.read_dir() {
                let mut manifests: Vec<_> = read
                    .flatten()
                    .filter(|entry| {
                        matches!(
                            entry.path().extension().and_then(|ext| ext.to_str()),
                            Some("yaml" | "yml")
                        )
                    })
                    .collect();
                manifests.sort_by_key(|entry| entry.file_name());
                for entry in manifests.into_iter().take(10) {
                    if let Ok(text) = std::fs::read_to_string(entry.path()) {
                        prompt.push_str(&format!(
                            "\n### {}\n```yaml\n{}\n```\n",
                            entry.file_name().to_string_lossy(),
                            truncate_file_content(&text, 1_200)
                        ));
                    }
                }
            }
        }
    }

    prompt
}

fn resolve_user_path(ctx: &BootstrapContext, value: &str) -> std::path::PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(&ctx.project_path).join(path)
    }
}

fn append_file_context(
    prompt: &mut String,
    label: &str,
    ctx: &BootstrapContext,
    value: &str,
    max_chars: usize,
) {
    let path = resolve_user_path(ctx, value);
    prompt.push_str(&format!("\n{label}: {}\n", path.display()));
    if let Ok(text) = std::fs::read_to_string(path) {
        let evidence = if label.starts_with("Helm ") {
            focused_helm_excerpt(&text)
        } else {
            text
        };
        prompt.push_str(&format!(
            "```yaml\n{}\n```\n",
            truncate_file_content(&evidence, max_chars)
        ));
    }
}
