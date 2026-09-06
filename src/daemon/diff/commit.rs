//! Committing staged work, and rejecting one hunk of it. "Accept" is a no-op
//! on the tree; only reject touches files.

use std::process::Stdio;

use anyhow::{anyhow, bail, Result};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use warpforge_protocol as wire;

use super::working::working_diff;

/// Stage files (all changes if `files` is None, else exactly those paths) and
/// commit them. `amend` rewrites the previous commit instead of creating a new
/// one. Returns git's stderr on failure.
pub async fn commit(
    repo: &str,
    message: &str,
    files: Option<&[String]>,
    amend: bool,
) -> Result<()> {
    // Stage.
    let mut add = Command::new("git");
    add.args(["-C", repo, "add", "--"]);
    match files {
        Some(paths) if !paths.is_empty() => {
            for p in paths {
                if p.contains("..") {
                    bail!("refusing path with ..: {p}");
                }
                add.arg(p);
            }
        }
        _ => {
            add.arg(".");
        }
    }
    let out = add.output().await?;
    if !out.status.success() {
        bail!(
            "git add failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }

    // Commit. An empty box on amend means "same message, new content" — the UI
    // allows it deliberately — so reuse the previous message instead of handing
    // git an empty `-m`, which it refuses.
    let mut ci = Command::new("git");
    ci.args(["-C", repo, "commit"]);
    if amend {
        ci.arg("--amend");
        if message.trim().is_empty() {
            ci.arg("--no-edit");
        } else {
            ci.args(["-m", message]);
        }
    } else {
        ci.args(["-m", message]);
    }
    let out = ci.output().await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let msg = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        bail!("git commit failed: {}", msg.trim());
    }
    Ok(())
}

/// `git add` exactly these paths, without committing. "Add to VCS" for
/// unversioned files: after this they show up as tracked changes. Refuses
/// `..` escapes and empty lists — both are caller bugs, not git invocations.
pub async fn stage_paths(repo: &str, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        bail!("nothing to add");
    }
    let mut add = Command::new("git");
    add.args(["-C", repo, "add", "--"]);
    for p in paths {
        if p.contains("..") {
            bail!("refusing path with ..: {p}");
        }
        add.arg(p);
    }
    let out = add.output().await?;
    if !out.status.success() {
        bail!(
            "git add failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

/// Full message (subject and body) of the repo's most recent commit. Returns an
/// empty string when there is nothing to read — a fresh repo with no commits is
/// not an error for callers, just nothing to amend.
pub async fn last_commit_message(repo: &str) -> Result<String> {
    let out = Command::new("git")
        .args(["-C", repo, "log", "-1", "--pretty=%B"])
        .output()
        .await?;
    if !out.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// Revert exactly one hunk of one file in the working tree.
pub async fn reject_hunk(repo: &str, file: &str, hunk_index: u32) -> Result<()> {
    let files = working_diff(repo).await?;
    let f = files
        .iter()
        .find(|f| f.path == file)
        .ok_or_else(|| anyhow!("file not in diff: {file}"))?;

    // Rejecting an added file means removing it.
    if f.status == wire::FileDiffStatus::Added {
        std::fs::remove_file(std::path::Path::new(repo).join(file))?;
        return Ok(());
    }

    let hunk = f
        .hunks
        .get(hunk_index as usize)
        .ok_or_else(|| anyhow!("hunk {hunk_index} out of range for {file}"))?;

    let patch = build_patch(f, hunk);
    let mut child = Command::new("git")
        .args([
            "-C",
            repo,
            "apply",
            "-R",
            "--recount",
            "--unidiff-zero",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(patch.as_bytes()).await?;
        stdin.flush().await?;
        drop(stdin);
    }
    let out = child.wait_with_output().await?;
    if !out.status.success() {
        bail!(
            "git apply -R failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

fn build_patch(f: &wire::FileDiff, h: &wire::Hunk) -> String {
    let old = f.old_path.as_deref().unwrap_or(&f.path);
    let mut s = String::new();
    s.push_str(&format!("--- a/{old}\n+++ b/{}\n", f.path));
    s.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        h.old_start, h.old_lines, h.new_start, h.new_lines
    ));
    for line in &h.lines {
        s.push_str(line);
        s.push('\n');
    }
    s
}

#[cfg(test)]
mod tests {
    use super::super::testsupport::{git, init_repo};
    use super::*;

    #[tokio::test]
    async fn diff_parses_and_reject_reverts() {
        let dir = std::env::temp_dir().join(format!("wf-diff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_str().unwrap();

        git(&dir, &["init", "-q"]).await;
        git(&dir, &["config", "user.email", "t@t"]).await;
        git(&dir, &["config", "user.name", "t"]).await;
        std::fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        // Modify a tracked line.
        std::fs::write(dir.join("a.txt"), "one\nTWO\nthree\n").unwrap();

        let files = working_diff(repo).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].status, wire::FileDiffStatus::Modified);
        assert_eq!(files[0].hunks.len(), 1);
        let body = files[0].hunks[0].lines.join("\n");
        assert!(body.contains("-two"), "hunk shows removal: {body}");
        assert!(body.contains("+TWO"), "hunk shows addition: {body}");

        // Reject the hunk -> file returns to its committed content.
        reject_hunk(repo, "a.txt", 0).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("a.txt")).unwrap(),
            "one\ntwo\nthree\n"
        );
        assert!(
            working_diff(repo).await.unwrap().is_empty(),
            "no changes after reject"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// An empty message on amend must keep the message being rewritten. Git
    /// refuses `-m ""`, so this used to abort the commit outright.
    #[tokio::test]
    async fn amend_without_a_message_keeps_the_previous_one() {
        let dir = std::env::temp_dir().join(format!("wf-amend-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit(repo, "feat: first\n\nwith a body", None, false)
            .await
            .unwrap();

        std::fs::write(dir.join("b.txt"), "two\n").unwrap();
        commit(repo, "", None, true).await.unwrap();

        assert_eq!(
            last_commit_message(repo).await.unwrap(),
            "feat: first\n\nwith a body"
        );
        let log = Command::new("git")
            .args(["-C", repo, "log", "--oneline"])
            .output()
            .await
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&log.stdout).lines().count(),
            1,
            "amend rewrites rather than adds"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn stage_paths_moves_untracked_into_the_index() {
        let dir = std::env::temp_dir().join(format!("wf-stage-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();
        std::fs::write(dir.join("keep.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).await;
        git(&dir, &["commit", "-q", "-m", "init"]).await;

        std::fs::write(dir.join("new.txt"), "brand new\n").unwrap();
        stage_paths(repo, &["new.txt".to_string()]).await.unwrap();

        // Staged = in the index, no longer untracked.
        let staged = Command::new("git")
            .args(["-C", repo, "diff", "--cached", "--name-only"])
            .output()
            .await
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&staged.stdout).trim(), "new.txt");
        let untracked = super::super::working::untracked_diff(repo).await.unwrap();
        assert!(
            untracked.iter().all(|f| f.path != "new.txt"),
            "staged file leaves Unversioned"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn stage_paths_refuses_escapes_and_empty_lists() {
        let dir = std::env::temp_dir().join(format!("wf-stage-neg-{}", uuid::Uuid::new_v4()));
        init_repo(&dir).await;
        let repo = dir.to_str().unwrap();

        assert!(stage_paths(repo, &[]).await.is_err());
        assert!(stage_paths(repo, &["../evil.txt".to_string()])
            .await
            .is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
