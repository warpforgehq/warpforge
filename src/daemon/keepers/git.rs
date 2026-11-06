use std::time::Duration;

use crate::daemon::workflow::DIFF_CONTEXT_MAX_BYTES;

const GIT_TIMEOUT: Duration = Duration::from_secs(20);
const LOG_LIMIT: &str = "200";
const RULES_MAX_BYTES: usize = 64 * 1024;

/// What a run needs to know about the change, read before it starts.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChangeQuery {
    /// The task's worktree.
    pub cwd: String,
    pub base_branch: Option<String>,
    pub head: String,
    /// Read the project's written rules for `{{rules}}`.
    pub rules: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Change {
    pub base_sha: Option<String>,
    /// `git diff <merge-base>..HEAD`, capped.
    pub diff: String,
    /// `<sha> <subject>`, newest first.
    pub log: Vec<String>,
    pub files: Vec<String>,
    pub rules: String,
}

/// Where HEADs and changes are read from. A test daemon reads a script and
/// never runs git (ADR 0030 invariant 12).
#[derive(Clone, Default)]
pub struct GitSource {
    #[cfg(test)]
    scripted: Option<std::sync::Arc<std::sync::Mutex<Scripted>>>,
}

/// A test's stand-in for git, keyed by worktree path.
#[cfg(test)]
#[derive(Debug, Default)]
pub struct Scripted {
    pub heads: std::collections::HashMap<String, String>,
    pub changes: std::collections::HashMap<String, Change>,
    /// Every worktree whose HEAD was read, in order.
    pub head_reads: Vec<String>,
}

impl GitSource {
    #[cfg(test)]
    pub fn scripted(script: std::sync::Arc<std::sync::Mutex<Scripted>>) -> Self {
        Self {
            scripted: Some(script),
        }
    }

    /// @param cwd a worktree
    /// @returns its HEAD sha, or `None` when it cannot be read
    pub async fn head(&self, cwd: &str) -> Option<String> {
        #[cfg(test)]
        {
            let mut script = self.scripted.as_ref()?.lock().unwrap();
            script.head_reads.push(cwd.to_string());
            script.heads.get(cwd).cloned()
        }
        #[cfg(not(test))]
        {
            git(cwd, &["rev-parse", "HEAD"]).await.ok()
        }
    }

    /// @param query the worktree, its base branch and the HEAD to read
    /// @returns the change from the merge-base to HEAD
    pub async fn change(&self, query: &ChangeQuery) -> Result<Change, String> {
        #[cfg(test)]
        {
            let script = self.scripted.as_ref().ok_or("no git in tests")?;
            let script = script.lock().unwrap();
            Ok(script.changes.get(&query.cwd).cloned().unwrap_or_default())
        }
        #[cfg(not(test))]
        {
            real_change(query).await
        }
    }
}

async fn real_change(query: &ChangeQuery) -> Result<Change, String> {
    let cwd = query.cwd.as_str();
    let refs: Vec<String> = match &query.base_branch {
        Some(base) => vec![base.clone(), format!("origin/{base}")],
        None => vec!["origin/HEAD".to_string()],
    };
    let mut base = None;
    for candidate in &refs {
        if let Ok(sha) = git(cwd, &["merge-base", &query.head, candidate]).await {
            base = Some(sha);
            break;
        }
    }
    let base = base.ok_or_else(|| format!("no merge-base with {}", refs.join(" or ")))?;
    let range = format!("{base}..{}", query.head);
    let diff = git(cwd, &["diff", "--no-color", "--no-ext-diff", &range]).await?;
    let log = git(cwd, &["log", "--format=%H %s", "-n", LOG_LIMIT, &range]).await?;
    let files = git(cwd, &["diff", "--name-only", "--no-renames", &range]).await?;
    let rules = if query.rules {
        read_rules(cwd).await
    } else {
        String::new()
    };
    Ok(Change {
        base_sha: Some(base),
        diff: cap(diff, DIFF_CONTEXT_MAX_BYTES),
        log: log.lines().map(str::to_string).collect(),
        files: files.lines().map(str::to_string).collect(),
        rules,
    })
}

async fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let run = tokio::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(GIT_TIMEOUT, run)
        .await
        .map_err(|_| format!("git {} timed out", args[0]))?
        .map_err(|e| format!("git {}: {e}", args[0]))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git {}: {}", args[0], stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// CLAUDE.md, AGENTS.md and the *Invariants* sections of the ADRs.
async fn read_rules(cwd: &str) -> String {
    let root = std::path::Path::new(cwd);
    let mut out = String::new();
    for name in ["CLAUDE.md", "AGENTS.md"] {
        if let Ok(text) = tokio::fs::read_to_string(root.join(name)).await {
            out.push_str(&format!("## {name}\n\n{}\n\n", text.trim()));
        }
    }
    let mut adrs = Vec::new();
    if let Ok(mut dir) = tokio::fs::read_dir(root.join("docs/adr")).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            adrs.push(entry.path());
        }
    }
    adrs.sort();
    for path in adrs
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
    {
        let Ok(text) = tokio::fs::read_to_string(path).await else {
            continue;
        };
        if let Some(section) = invariants(&text) {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            out.push_str(&format!("## {name}, invariants\n\n{section}\n\n"));
        }
    }
    cap(out, RULES_MAX_BYTES)
}

fn invariants(adr: &str) -> Option<&str> {
    let start = adr.find("\n## Invariants")? + 1;
    let rest = &adr[start..];
    let end = rest[3..].find("\n## ").map_or(rest.len(), |i| i + 3);
    Some(rest[..end].trim())
}

fn cap(mut text: String, max: usize) -> String {
    if text.len() > max {
        text.truncate(text.floor_char_boundary(max));
        text.push_str("\n[…truncated…]");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn run(cwd: &std::path::Path, args: &[&str]) {
        let out = tokio::process::Command::new("git")
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "init.defaultBranch=main",
            ])
            .args(args)
            .current_dir(cwd)
            .output()
            .await
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[tokio::test]
    async fn a_branch_change_is_read_from_its_merge_base() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        run(repo, &["init", "-q"]).await;
        std::fs::write(repo.join("README.md"), "one\n").unwrap();
        std::fs::create_dir_all(repo.join("docs/adr")).unwrap();
        std::fs::write(
            repo.join("docs/adr/0001-x.md"),
            "# X\n\n## Invariants\n\n1. Never.\n\n## Phases\n\nlater\n",
        )
        .unwrap();
        run(repo, &["add", "."]).await;
        run(repo, &["commit", "-qm", "base"]).await;
        run(repo, &["checkout", "-qb", "task"]).await;
        std::fs::write(repo.join("lib.rs"), "fn parse() {}\n").unwrap();
        run(repo, &["add", "."]).await;
        run(repo, &["commit", "-qm", "add the parser"]).await;
        let cwd = repo.to_string_lossy().into_owned();
        let head = git(&cwd, &["rev-parse", "HEAD"]).await.unwrap();

        let change = real_change(&ChangeQuery {
            cwd,
            base_branch: Some("main".into()),
            head: head.clone(),
            rules: true,
        })
        .await
        .unwrap();
        assert_eq!(change.files, vec!["lib.rs".to_string()]);
        assert!(change.diff.contains("+fn parse() {}"), "{}", change.diff);
        assert_eq!(change.log, vec![format!("{head} add the parser")]);
        assert!(change.rules.contains("1. Never."), "{}", change.rules);
        assert!(!change.rules.contains("later"), "{}", change.rules);
    }
}
