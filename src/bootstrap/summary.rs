use std::path::Path;

use super::excerpt::{
    focused_env_excerpt, focused_source_excerpt, truncate_file_content, yaml_keys_or_sequence,
    yaml_scalar_or_sequence,
};

// ── Repo Summary ─────────────────────────────────────────────────────────────

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "coverage",
    "generated",
    ".turbo",
    ".astro",
    ".keycloakify",
    "dist_keycloak",
    ".next",
    ".nuxt",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
];

const KEY_FILES: &[&str] = &[
    "package.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "nuxt.config.ts",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "Dockerfile",
    "Makefile",
    "CMakeLists.txt",
    "pnpm-workspace.yaml",
    "lerna.json",
    "turbo.json",
    "nx.json",
    "Procfile",
    "docker-bake.hcl",
    "Chart.yaml",
    "go.mod",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "Gemfile",
    ".env",
    ".env.example",
];

pub fn build_repo_summary(project_path: &str) -> String {
    let path = Path::new(project_path);
    let mut out = String::new();

    // Show the workspace skeleton, not application source/generated files.
    // Package scripts and focused excerpts below carry the service evidence.
    out.push_str("## File tree\n\n");
    let mut entries = Vec::new();
    collect_tree(path, path, 0, 1, &mut entries);
    if entries.len() > 250 {
        entries.truncate(250);
        entries.push("... (file tree limited to 250 entries)".into());
    }
    for e in &entries {
        out.push_str(e);
        out.push('\n');
    }
    out.push('\n');

    let mut key_files = Vec::new();
    collect_key_files(path, 0, 5, &mut key_files);
    key_files.sort_by(|left, right| {
        config_evidence_priority(left)
            .cmp(&config_evidence_priority(right))
            .then_with(|| left.cmp(right))
    });

    // Only runnable packages matter here; build-only libraries overwhelm large
    // monorepos without helping the agent discover services.
    out.push_str("## Runnable package scripts\n\n");
    let mut package_count = 0;
    for summary in key_files
        .iter()
        .filter(|file| file.file_name().and_then(|n| n.to_str()) == Some("package.json"))
        .filter_map(|file| summarize_package_json(path, file))
        .take(30)
    {
        out.push_str(&summary);
        package_count += 1;
    }
    if package_count == 0 {
        out.push_str("(none found)\n\n");
    }

    // docker-compose services summary (commands, dependencies, and port
    // mappings are more useful than a blind excerpt for service discovery).
    for compose_name in &[
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ] {
        let compose_path = path.join(compose_name);
        if compose_path.exists() {
            if let Ok(text) = std::fs::read_to_string(&compose_path) {
                if let Ok(compose) = serde_yaml::from_str::<serde_yaml::Value>(&text) {
                    if let Some(svcs) = compose["services"].as_mapping() {
                        out.push_str(&format!("### {compose_name} services\n\n"));
                        for (k, v) in svcs {
                            let svc_name = k.as_str().unwrap_or("?");
                            let ports = v["ports"]
                                .as_sequence()
                                .map(|p| {
                                    p.iter()
                                        .filter_map(|x| x.as_str())
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                })
                                .unwrap_or_default();
                            let image = v["image"].as_str().unwrap_or("");
                            let command = yaml_scalar_or_sequence(&v["command"]);
                            let depends_on = yaml_keys_or_sequence(&v["depends_on"]);
                            out.push_str(&format!(
                                "- {svc_name}: image={image} command={command} ports=[{ports}] dependsOn=[{depends_on}]\n"
                            ));
                        }
                        out.push('\n');
                    }
                }
            }
            break;
        }
    }

    out.push_str("## Runtime evidence excerpts\n\n");
    for file in key_files
        .iter()
        .filter(|file| should_excerpt_config(file))
        .take(24)
    {
        if let Ok(content) = std::fs::read_to_string(file) {
            let relative = file.strip_prefix(path).unwrap_or(file).display();
            let file_name = file
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            let content = if file_name.starts_with(".env") {
                focused_env_excerpt(&content)
            } else if file_name.starts_with("vite.config.") || is_runnable_package_entrypoint(file)
            {
                focused_source_excerpt(&content)
            } else {
                content
            };
            if content.trim().is_empty() {
                continue;
            }
            let max_chars = 3_000;
            let truncated = truncate_file_content(&content, max_chars);
            out.push_str(&format!("### {relative}\n\n```\n{truncated}\n```\n\n"));
        }
    }

    truncate_file_content(&out, 32_000)
}

fn collect_tree(root: &Path, dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<String>) {
    if depth > max_depth {
        return;
    }
    let Ok(read) = dir.read_dir() else {
        return;
    };
    let mut entries: Vec<_> = read.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && depth == 0 && name != ".env" && name != ".env.example" {
            continue;
        }
        if file_type.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(root)
                .unwrap_or(&entry.path())
                .display()
                .to_string();
            out.push(format!("{relative}/"));
            collect_tree(root, &entry.path(), depth + 1, max_depth, out);
        } else if depth == 0 {
            let relative = entry
                .path()
                .strip_prefix(root)
                .unwrap_or(&entry.path())
                .display()
                .to_string();
            out.push(relative);
        }
    }
}

fn collect_key_files(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<std::path::PathBuf>,
) {
    if depth > max_depth {
        return;
    }
    let Ok(read) = dir.read_dir() else {
        return;
    };
    for entry in read.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                collect_key_files(&path, depth + 1, max_depth, out);
            }
        } else if KEY_FILES.contains(&name.as_str())
            || name.starts_with("vite.config.")
            || safe_env_evidence_file(&name)
            || is_runnable_package_entrypoint(&path)
        {
            out.push(path);
        }
    }
}

fn summarize_package_json(root: &Path, file: &Path) -> Option<String> {
    let text = std::fs::read_to_string(file).ok()?;
    let package: serde_json::Value = serde_json::from_str(&text).ok()?;
    let relative_path = file.strip_prefix(root).unwrap_or(file);
    let relative = relative_path.display();
    let name = package["name"].as_str().unwrap_or("(unnamed)");
    let package_manager = package["packageManager"].as_str().unwrap_or("");
    let mut out = format!("### {relative}\nname: {name}\n");
    if !package_manager.is_empty() {
        out.push_str(&format!("packageManager: {package_manager}\n"));
    }
    if let Some(scripts) = package["scripts"].as_object() {
        let mut scripts: Vec<_> = scripts
            .iter()
            .filter(|(script, _)| runtime_script_name(script))
            .collect();
        if scripts.is_empty() && relative_path != Path::new("package.json") {
            return None;
        }
        scripts.sort_by_key(|(name, _)| *name);
        out.push_str("scripts:\n");
        for (script, command) in scripts {
            if let Some(command) = command.as_str() {
                out.push_str(&format!("- {script}: {command}\n"));
            }
        }
    } else {
        out.push_str("scripts: (none)\n");
    }
    out.push('\n');
    Some(out)
}

pub(super) fn runtime_script_name(name: &str) -> bool {
    name == "dev"
        || name.starts_with("dev:")
        || name == "start"
        || name.starts_with("start:")
        || name == "serve"
        || name.starts_with("serve:")
        || name == "preview"
        || name.starts_with("port-forward")
}

fn config_evidence_priority(path: &Path) -> u8 {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if name.ends_with(".example") {
        1
    } else if name.starts_with("vite.config.") {
        2
    } else if name.starts_with(".env") {
        3
    } else if is_runnable_package_entrypoint(path) {
        4
    } else if matches!(
        name,
        "docker-compose.yml" | "docker-compose.yaml" | "compose.yml" | "compose.yaml"
    ) {
        5
    } else if name == "package.json" {
        6
    } else {
        7
    }
}

fn should_excerpt_config(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    name != "package.json"
        && (safe_env_evidence_file(name)
            || name.starts_with("vite.config.")
            || is_runnable_package_entrypoint(path)
            || matches!(
                name,
                "Procfile" | "Makefile" | "pyproject.toml" | "Cargo.toml" | "go.mod"
            ))
}

fn safe_env_evidence_file(name: &str) -> bool {
    name.starts_with(".env") && (!name.contains(".local") || name.ends_with(".example"))
}

fn is_runnable_package_entrypoint(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if !matches!(name, "main.ts" | "index.ts") {
        return false;
    }
    let Some(source_dir) = path.parent() else {
        return false;
    };
    if source_dir.file_name().and_then(|name| name.to_str()) != Some("src") {
        return false;
    }
    let Some(package_root) = source_dir.parent() else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(package_root.join("package.json")) else {
        return false;
    };
    let Ok(package) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    package["scripts"]
        .as_object()
        .is_some_and(|scripts| scripts.keys().any(|name| runtime_script_name(name)))
}
