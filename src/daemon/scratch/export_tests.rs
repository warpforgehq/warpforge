use super::*;

const IDENTITY: [(&str, &str); 6] = [
    ("GIT_CONFIG_GLOBAL", "/dev/null"),
    ("GIT_CONFIG_NOSYSTEM", "1"),
    ("GIT_AUTHOR_NAME", "Chat Test"),
    ("GIT_AUTHOR_EMAIL", "chat@example.com"),
    ("GIT_COMMITTER_NAME", "Chat Test"),
    ("GIT_COMMITTER_EMAIL", "chat@example.com"),
];

/// No identity anywhere, and git told not to guess one from the hostname.
const NO_IDENTITY: [(&str, &str); 5] = [
    ("GIT_CONFIG_GLOBAL", "/dev/null"),
    ("GIT_CONFIG_NOSYSTEM", "1"),
    ("GIT_CONFIG_COUNT", "1"),
    ("GIT_CONFIG_KEY_0", "user.useConfigOnly"),
    ("GIT_CONFIG_VALUE_0", "true"),
];

fn temp(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wf-export-{tag}-{}",
        &uuid::Uuid::new_v4().to_string()[..8]
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn chat_with_files() -> PathBuf {
    let src = temp("src");
    std::fs::create_dir_all(src.join("app/node_modules/dep")).unwrap();
    std::fs::create_dir_all(src.join(".venv/bin")).unwrap();
    std::fs::create_dir_all(src.join("node_modules")).unwrap();
    std::fs::write(src.join("notes.md"), "keep").unwrap();
    std::fs::write(src.join("app/main.js"), "run()").unwrap();
    std::fs::write(src.join("app/node_modules/dep/index.js"), "x").unwrap();
    std::fs::write(src.join(".venv/bin/python"), "x").unwrap();
    src
}

fn listing(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in std::fs::read_dir(&next).unwrap().flatten() {
            let path = entry.path();
            if entry.file_name() == ".git" {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                stack.push(path.clone());
            }
            out.push(path.strip_prefix(dir).unwrap().display().to_string());
        }
    }
    out.sort();
    out
}

fn git_out(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .envs(IDENTITY)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn copies_files_but_not_dependency_folders_at_any_depth() {
    let src = chat_with_files();
    let dest = temp("parent").join("project");
    export_with(&src, &dest, false, &IDENTITY).unwrap();
    assert_eq!(listing(&dest), ["app", "app/main.js", "notes.md"]);
    assert!(
        src.join("app/node_modules/dep/index.js").exists(),
        "chat keeps its files"
    );
    std::fs::write(src.join("later.md"), "still writable").unwrap();
}

#[test]
fn a_non_empty_target_is_refused_and_left_alone() {
    let src = chat_with_files();
    let dest = temp("busy");
    std::fs::write(dest.join("mine.txt"), "not yours").unwrap();
    let error = export_with(&src, &dest, false, &IDENTITY).unwrap_err();
    assert!(error.contains("not empty"), "{error}");
    assert_eq!(listing(&dest), ["mine.txt"]);
    let parent = dest.parent().unwrap();
    let staged = std::fs::read_dir(parent)
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().contains(".warpforge-"));
    assert!(!staged, "no staging folder left behind");

    let file = temp("file").join("plain");
    std::fs::write(&file, "a file, not a folder").unwrap();
    assert!(export_with(&src, &file, false, &IDENTITY).is_err());
}

#[test]
fn an_existing_empty_target_is_filled() {
    let src = chat_with_files();
    let dest = temp("empty");
    export_with(&src, &dest, false, &IDENTITY).unwrap();
    assert!(dest.join("notes.md").exists());
}

#[test]
fn symlinks_are_skipped_not_followed() {
    let src = chat_with_files();
    let outside = temp("outside");
    std::fs::write(outside.join("secret"), "private").unwrap();
    std::os::unix::fs::symlink(outside.join("secret"), src.join("link-file")).unwrap();
    std::os::unix::fs::symlink(&outside, src.join("link-dir")).unwrap();
    std::os::unix::fs::symlink("notes.md", src.join("relative")).unwrap();
    let dest = temp("links").join("project");
    export_with(&src, &dest, false, &IDENTITY).unwrap();
    assert_eq!(listing(&dest), ["app", "app/main.js", "notes.md"]);
}

#[test]
fn git_on_commits_the_copied_files() {
    let src = chat_with_files();
    let dest = temp("git").join("project");
    export_with(&src, &dest, true, &IDENTITY).unwrap();
    assert_eq!(git_out(&dest, &["status", "--porcelain"]), "");
    let files = git_out(&dest, &["ls-files"]);
    assert_eq!(
        files.lines().collect::<Vec<_>>(),
        ["app/main.js", "notes.md"]
    );
}

#[test]
fn git_off_leaves_a_plain_folder() {
    let src = chat_with_files();
    let dest = temp("nogit").join("project");
    export_with(&src, &dest, false, &IDENTITY).unwrap();
    assert!(!dest.join(".git").exists());
}

#[test]
fn a_missing_git_identity_is_reported_and_nothing_is_created() {
    let src = chat_with_files();
    let dest = temp("noid").join("project");
    let error = export_with(&src, &dest, true, &NO_IDENTITY).unwrap_err();
    assert!(error.contains("user.email"), "{error}");
    assert!(!dest.exists());
    assert_eq!(
        std::fs::read_dir(dest.parent().unwrap()).unwrap().count(),
        0
    );
}

#[test]
fn targets_are_full_paths_outside_the_chats_folder() {
    let home = Path::new("/Users/someone");
    assert_eq!(
        resolve_target("~/workspace/notes", Some(home)).unwrap(),
        home.join("workspace/notes")
    );
    assert_eq!(
        resolve_target(" /tmp/x ", Some(home)).unwrap(),
        PathBuf::from("/tmp/x")
    );
    let inside = super::super::root().join("t_1/sub");
    for bad in [
        "",
        "workspace/notes",
        "~user/notes",
        "/tmp/../etc",
        "/",
        inside.to_str().unwrap(),
    ] {
        assert!(resolve_target(bad, Some(home)).is_err(), "{bad:?}");
    }
    assert!(resolve_target("~/x", None).is_err());
}

#[test]
fn a_chat_repository_is_replaced_by_a_fresh_one_only_when_git_is_on() {
    let src = chat_with_files();
    std::fs::create_dir_all(src.join(".git/hooks")).unwrap();
    std::fs::write(src.join(".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n").unwrap();
    let fresh = temp("fresh").join("project");
    export_with(&src, &fresh, true, &IDENTITY).unwrap();
    assert!(!fresh.join(".git/hooks/pre-commit").exists());
    assert_eq!(git_out(&fresh, &["rev-list", "--count", "HEAD"]), "1");

    let kept = temp("kept").join("project");
    export_with(&src, &kept, false, &IDENTITY).unwrap();
    assert!(kept.join(".git/hooks/pre-commit").exists());
}
