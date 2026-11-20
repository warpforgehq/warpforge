use std::path::Path;
use std::process::Command;

use sha2::{Digest, Sha512};

use super::managed::{install_script_at, is_managed_under};
use super::*;

fn manifest(version: &str, url: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "version": version, "url": url, "sha512": "ab".repeat(64)
    }))
    .unwrap()
}

#[test]
fn maps_supported_targets() {
    for (os, arch, musl, expected) in [
        ("macos", "aarch64", false, "darwin_arm64"),
        ("macos", "x86_64", false, "darwin_amd64"),
        ("linux", "aarch64", true, "linux_arm64_musl"),
        ("linux", "x86_64", false, "linux_amd64"),
        ("windows", "x86_64", false, "windows_amd64"),
        ("windows", "aarch64", false, "windows_arm64"),
    ] {
        assert_eq!(target(os, arch, musl).as_deref(), Some(expected));
    }
    assert!(target("freebsd", "x86_64", false).is_none());
    assert!(target("linux", "riscv64", false).is_none());
}

#[test]
fn parses_release_and_rejects_bad_schema() {
    let url = "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.1-123/darwin-arm/cli_mac_arm64.tar.gz";
    let valid = manifest("1.5.1", url);
    assert_eq!(
        parse_manifest(&valid, "macos", "aarch64", false)
            .unwrap()
            .version,
        "1.5.1"
    );
    for version in ["1.5", "1.5.1-beta", "v1.5.1", "1..1"] {
        assert!(parse_manifest(&manifest(version, url), "macos", "aarch64", false).is_none());
    }
    let mut invalid: serde_json::Value = serde_json::from_slice(&valid).unwrap();
    invalid["sha512"] = "no checksum".into();
    assert!(parse_manifest(
        &serde_json::to_vec(&invalid).unwrap(),
        "macos",
        "aarch64",
        false
    )
    .is_none());
}

#[test]
fn rejects_untrusted_or_wrong_platform_urls() {
    let url = "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.1-123/darwin-arm/cli_mac_arm64.tar.gz";
    for bad in [
        url.replace("https:", "http:"),
        url.replace("storage.googleapis.com/", "storage.googleapis.com.evil/"),
        url.replace("1.5.1-", "1.5.0-"),
        url.replace("-123/", "-../"),
        format!("{url}?other=1"),
        url.replace("darwin-arm", "darwin-x64"),
    ] {
        assert!(
            parse_manifest(&manifest("1.5.1", &bad), "macos", "aarch64", false).is_none(),
            "{bad}"
        );
    }
}

#[test]
fn minimum_is_1_5() {
    assert!(below_minimum("1.4.99"));
    assert!(!below_minimum("1.5.0"));
    assert!(!below_minimum("1.5.1"));
    assert!(!below_minimum("1.10.0"));
    assert!(compare_versions("1.5.0", "1.5.1").is_lt());
}

/// A release tarball holding one `antigravity` that prints its version and
/// whether self-update is disabled, plus a `curl` stub that serves it.
struct Release {
    dir: tempfile::TempDir,
    sha512: String,
}

fn release(version: &str) -> Release {
    let dir = tempfile::tempdir().unwrap();
    let stage = dir.path().join("stage");
    std::fs::create_dir(&stage).unwrap();
    std::fs::write(
        stage.join("antigravity"),
        format!("#!/bin/sh\necho \"{version} $AGY_CLI_DISABLE_AUTO_UPDATE\"\n"),
    )
    .unwrap();
    let archive = dir.path().join("cli.tar.gz");
    let tar = Command::new("tar")
        .arg("-czf")
        .arg(&archive)
        .arg("-C")
        .arg(&stage)
        .arg("antigravity")
        .status()
        .unwrap();
    assert!(tar.success());
    let fakebin = dir.path().join("bin");
    std::fs::create_dir(&fakebin).unwrap();
    std::fs::write(
        fakebin.join("curl"),
        format!(
            "#!/bin/sh\nwhile [ $# -gt 0 ]; do [ \"$1\" = -o ] && cp '{}' \"$2\"; shift; done\n",
            archive.display()
        ),
    )
    .unwrap();
    Command::new("chmod")
        .arg("755")
        .arg(fakebin.join("curl"))
        .status()
        .unwrap();
    let sha512 = format!("{:x}", Sha512::digest(std::fs::read(&archive).unwrap()));
    Release { dir, sha512 }
}

fn install(root: &Path, version: &str, release: &Release, sha512: &str) -> bool {
    let manifest = Manifest {
        version: version.into(),
        url: format!("https://storage.googleapis.com/antigravity-public/antigravity-cli/{version}-1/darwin-arm/cli_mac_arm64.tar.gz"),
        sha512: sha512.into(),
    };
    let script = install_script_at(root, &manifest).unwrap();
    let path = format!(
        "{}:{}",
        release.dir.path().join("bin").display(),
        std::env::var("PATH").unwrap()
    );
    Command::new("sh")
        .args(["-c", &script])
        .env("PATH", path)
        .status()
        .unwrap()
        .success()
}

fn run_launcher(root: &Path) -> String {
    let out = Command::new(root.join("bin/agy")).output().unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

#[test]
fn installs_a_launcher_that_disables_self_update_and_prunes_old_versions() {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().join("it's agents");
    let old = release("1.5.0");
    assert!(install(&root, "1.5.0", &old, &old.sha512));
    assert_eq!(run_launcher(&root), "1.5.0 1");

    let new = release("1.5.1");
    assert!(install(&root, "1.5.1", &new, &new.sha512));
    assert_eq!(run_launcher(&root), "1.5.1 1");
    assert!(!root.join("1.5.0").exists());
    assert!(root.join("1.5.1/antigravity").exists());
}

#[test]
fn a_checksum_mismatch_keeps_the_active_version() {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().join("agents");
    let good = release("1.5.0");
    assert!(install(&root, "1.5.0", &good, &good.sha512));

    let bad = release("1.5.1");
    assert!(!install(&root, "1.5.1", &bad, &"0".repeat(128)));
    assert_eq!(run_launcher(&root), "1.5.0 1");
    assert!(!root.join("1.5.1").exists());
    let leftovers: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(".install"))
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
fn only_the_launcher_under_the_managed_root_is_managed() {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().join("agents");
    std::fs::create_dir_all(root.join("bin")).unwrap();
    let real = std::fs::canonicalize(&root).unwrap();
    assert!(is_managed_under(
        &root,
        real.join("bin/agy").to_str().unwrap()
    ));
    assert!(!is_managed_under(&root, "/opt/homebrew/bin/agy"));
    assert!(!is_managed_under(&root, "/Users/u/.local/bin/agy"));
}
