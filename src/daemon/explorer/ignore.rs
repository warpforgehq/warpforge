//! Classifies a path under a root as visible, ignored (git's rules) or hidden
//! (Warpforge's own rules, never listed). See ADR 0028.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use ::ignore::gitignore::{Gitignore, GitignoreBuilder};
use ::ignore::Match;

use crate::daemon::diff::is_ignored_path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Class {
    Visible,
    Ignored,
    Hidden,
}

/// Gitignore rules for one checkout: nested `.gitignore`s, `info/exclude` and
/// the global excludes file. Matchers load lazily per directory and are cached
/// until [`IgnoreStack::forget`].
pub(crate) struct IgnoreStack {
    root: PathBuf,
    git: bool,
    exclude: Option<Gitignore>,
    global: Option<Gitignore>,
    per_dir: HashMap<PathBuf, Option<Gitignore>>,
    dir_ignored: HashMap<PathBuf, bool>,
    tracked: Arc<super::TrackedIgnored>,
}

impl IgnoreStack {
    /// Rules for the checkout at `root`; `common_dir` is `None` for a non-git
    /// project, which then has hidden paths but no ignored ones.
    pub(crate) fn new(root: &Path, common_dir: Option<&Path>) -> Self {
        let exclude = common_dir.and_then(|dir| {
            let mut builder = GitignoreBuilder::new(root);
            builder.add(dir.join("info").join("exclude"));
            builder.build().ok().filter(|m| !m.is_empty())
        });
        let global = common_dir
            .map(|_| Gitignore::global().0)
            .filter(|m| !m.is_empty());
        Self {
            root: root.to_path_buf(),
            git: common_dir.is_some(),
            exclude,
            global,
            per_dir: HashMap::new(),
            dir_ignored: HashMap::new(),
            tracked: Arc::default(),
        }
    }

    /// Rules for `root`, asking git where its common dir is.
    pub(crate) async fn open(root: &Path) -> Self {
        let out = tokio::process::Command::new("git")
            .args(["--no-optional-locks", "-C"])
            .arg(root)
            .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
            .output()
            .await;
        let common = out
            .ok()
            .filter(|o| o.status.success())
            .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()));
        Self::new(root, common.as_deref())
    }

    /// Treats `tracked` (tracked files under an ignore pattern, and their
    /// directories) as not ignored, as git does.
    pub(crate) fn with_tracked(mut self, tracked: Arc<super::TrackedIgnored>) -> Self {
        self.set_tracked(tracked);
        self
    }

    pub(crate) fn set_tracked(&mut self, tracked: Arc<super::TrackedIgnored>) {
        self.tracked = tracked;
    }

    /// Classifies `rel`, a non-empty `/`-separated path under the root.
    pub(crate) fn classify(&mut self, rel: &str, is_dir: bool) -> Class {
        if is_ignored_path(rel) {
            return Class::Hidden;
        }
        if self.is_ignored(Path::new(rel), is_dir) && !self.tracked.contains(rel) {
            Class::Ignored
        } else {
            Class::Visible
        }
    }

    /// Drops cached matchers and verdicts, after a `.gitignore` changed.
    pub(crate) fn forget(&mut self) {
        self.per_dir.clear();
        self.dir_ignored.clear();
    }

    fn is_ignored(&mut self, rel: &Path, is_dir: bool) -> bool {
        if !self.git {
            return false;
        }
        if let Some(parent) = rel.parent().filter(|p| !p.as_os_str().is_empty()) {
            if self.dir_is_ignored(parent) {
                return true;
            }
        }
        self.matches(rel, is_dir)
    }

    fn dir_is_ignored(&mut self, rel: &Path) -> bool {
        if let Some(&known) = self.dir_ignored.get(rel) {
            return known;
        }
        let ignored = self.is_ignored(rel, true);
        self.dir_ignored.insert(rel.to_path_buf(), ignored);
        ignored
    }

    /// Git's precedence: the deepest `.gitignore` with a matching pattern
    /// decides, then `info/exclude`, then the global file.
    fn matches(&mut self, rel: &Path, is_dir: bool) -> bool {
        let full = self.root.join(rel);
        for dir in rel.ancestors().skip(1) {
            let verdict = self
                .matcher(dir)
                .map(|m| m.matched(&full, is_dir))
                .unwrap_or(Match::None);
            match verdict {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
        }
        for m in [&self.exclude, &self.global].into_iter().flatten() {
            match m.matched(&full, is_dir) {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
        }
        false
    }

    fn matcher(&mut self, dir: &Path) -> Option<&Gitignore> {
        let root = &self.root;
        self.per_dir
            .entry(dir.to_path_buf())
            .or_insert_with(|| {
                let abs = root.join(dir);
                let file = abs.join(".gitignore");
                if !file.is_file() {
                    return None;
                }
                let mut builder = GitignoreBuilder::new(&abs);
                builder.add(file);
                builder.build().ok().filter(|m| !m.is_empty())
            })
            .as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::diff::testsupport::init_repo;

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    async fn git_ignored(root: &Path, paths: &[&str]) -> Vec<String> {
        let out = tokio::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .arg("check-ignore")
            .args(paths)
            .output()
            .await
            .unwrap();
        let mut found: Vec<String> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::to_string)
            .collect();
        found.sort();
        found
    }

    #[tokio::test]
    async fn agrees_with_git_check_ignore() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        init_repo(root).await;
        write(
            root,
            ".gitignore",
            "*.log\nbuild/\n/top-only.txt\n!keep.log\n",
        );
        write(root, "app/.gitignore", "local.env\n!debug.log\ncache\n");
        write(root, ".git/info/exclude", "scratch/\n");
        let paths = [
            "a.log",
            "keep.log",
            "app/debug.log",
            "app/other.log",
            "app/local.env",
            "app/cache/x.txt",
            "build/out.bin",
            "app/build/out.bin",
            "top-only.txt",
            "app/top-only.txt",
            "scratch/notes.md",
            "src/main.rs",
        ];
        for path in paths {
            write(root, path, "x");
        }

        let mut stack = IgnoreStack::open(root).await;
        let mut ours: Vec<String> = paths
            .iter()
            .filter(|p| stack.classify(p, false) == Class::Ignored)
            .map(|p| p.to_string())
            .collect();
        ours.sort();
        assert_eq!(ours, git_ignored(root, &paths).await);
    }

    #[tokio::test]
    async fn warpforge_rules_hide_before_git_rules_apply() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        init_repo(root).await;
        write(root, ".gitignore", "node_modules/\n.env\n");
        let mut stack = IgnoreStack::open(root).await;
        assert_eq!(stack.classify("node_modules", true), Class::Hidden);
        assert_eq!(stack.classify("pkg/target", true), Class::Hidden);
        assert_eq!(stack.classify(".git", true), Class::Hidden);
        assert_eq!(stack.classify(".warpforge/worktrees", true), Class::Hidden);
        assert_eq!(stack.classify(".DS_Store", false), Class::Hidden);
        assert_eq!(stack.classify(".env", false), Class::Ignored);
        assert_eq!(stack.classify("src", true), Class::Visible);
    }

    #[tokio::test]
    async fn a_non_git_root_has_no_ignored_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, ".gitignore", "*.log\n");
        let mut stack = IgnoreStack::open(root).await;
        assert_eq!(stack.classify("a.log", false), Class::Visible);
        assert_eq!(stack.classify("node_modules", true), Class::Hidden);
    }

    #[tokio::test]
    async fn forget_picks_up_an_edited_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        init_repo(root).await;
        write(root, ".gitignore", "");
        let mut stack = IgnoreStack::open(root).await;
        assert_eq!(stack.classify("a.log", false), Class::Visible);
        write(root, ".gitignore", "*.log\n");
        stack.forget();
        assert_eq!(stack.classify("a.log", false), Class::Ignored);
    }
}
