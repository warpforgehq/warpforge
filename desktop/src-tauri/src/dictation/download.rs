use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::catalog::ModelEntry;

/// Progress of one model download, emitted as `dictation:progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: &'static str,
    pub downloaded: u64,
    pub total: u64,
}

/// What to do with whatever a previous attempt left on disk.
#[derive(Debug, PartialEq, Eq)]
pub enum Plan {
    /// Nothing usable: start from byte 0.
    Fresh,
    /// Ask the server for the rest, starting at this offset.
    Resume(u64),
    /// The partial file is full length; only the checksum is left.
    Verify,
}

/// Decide how to continue from a partial file of `partial_len` bytes.
/// @param partial_len size of the `.part` file, 0 when absent
/// @param total pinned size of the model
/// @returns the plan for this attempt
pub fn plan(partial_len: u64, total: u64) -> Plan {
    match partial_len {
        0 => Plan::Fresh,
        len if len < total => Plan::Resume(len),
        len if len == total => Plan::Verify,
        _ => Plan::Fresh,
    }
}

/// Lowercase hex SHA-256 of a file, streamed.
/// @param path file to hash
/// @returns the digest as 64 hex characters
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn part_path(dir: &Path, entry: &ModelEntry) -> PathBuf {
    dir.join(format!("{}.part", entry.file))
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Download `entry` into `dir`, resuming a previous partial file. Blocks; run
/// it off the async runtime. `curl` does the HTTP so no TLS stack is linked in.
/// @param dir models directory
/// @param entry model to fetch
/// @param cancel set to abort; the partial file is kept for a later resume
/// @param on_progress called roughly every 250 ms with bytes on disk
/// @returns the path of the verified model file
pub fn download(
    dir: &Path,
    entry: &'static ModelEntry,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(Progress),
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let target = dir.join(entry.file);
    let part = part_path(dir, entry);
    let report = |downloaded| Progress {
        id: entry.id,
        downloaded,
        total: entry.size,
    };

    let offset = match plan(file_len(&part), entry.size) {
        Plan::Verify => None,
        Plan::Resume(offset) => Some(offset),
        Plan::Fresh => {
            let _ = std::fs::remove_file(&part);
            Some(0)
        }
    };
    if let Some(offset) = offset {
        let mut command = Command::new("curl");
        command
            .args(["--fail", "--location", "--silent", "--show-error"])
            .args(["--retry", "3", "--connect-timeout", "20"]);
        if offset > 0 {
            command.arg("--continue-at").arg(offset.to_string());
        }
        let mut child = command
            .arg("--output")
            .arg(&part)
            .arg(entry.url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start the download (curl): {e}"))?;
        let status = loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Download cancelled.".into());
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {}
                Err(e) => return Err(format!("Download failed: {e}")),
            }
            on_progress(report(file_len(&part)));
            std::thread::sleep(Duration::from_millis(250));
        };
        if !status.success() {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            return Err(format!("Download failed: {}", stderr.trim()));
        }
    }
    on_progress(report(file_len(&part)));
    finalize(&part, &target, entry)
}

/// Check a finished partial file and move it into place. A bad file is
/// deleted so the next attempt starts clean.
fn finalize(part: &Path, target: &Path, entry: &ModelEntry) -> Result<PathBuf, String> {
    let len = file_len(part);
    if len != entry.size {
        if len > entry.size {
            let _ = std::fs::remove_file(part);
        }
        return Err(format!(
            "Download incomplete ({len} of {} bytes). Try again to resume.",
            entry.size
        ));
    }
    let digest = sha256_file(part).map_err(|e| format!("Could not verify the model: {e}"))?;
    if digest != entry.sha256 {
        let _ = std::fs::remove_file(part);
        return Err("The downloaded model failed its checksum and was discarded.".into());
    }
    std::fs::rename(part, target).map_err(|e| format!("Could not install the model: {e}"))?;
    Ok(target.to_path_buf())
}

/// Remove a model and any partial download of it.
/// @param dir models directory
/// @param entry model to remove
pub fn delete(dir: &Path, entry: &ModelEntry) -> Result<(), String> {
    for path in [dir.join(entry.file), part_path(dir, entry)] {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not delete {}: {e}", path.display())),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dictation::test_dir;

    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn entry(size: u64, sha256: &'static str) -> &'static ModelEntry {
        Box::leak(Box::new(ModelEntry {
            id: "test",
            label: "Test",
            description: "",
            file: "test.bin",
            url: "https://invalid.example/test.bin",
            sha256,
            size,
        }))
    }

    #[test]
    fn plan_from_partial_length() {
        assert_eq!(plan(0, 10), Plan::Fresh);
        assert_eq!(plan(4, 10), Plan::Resume(4));
        assert_eq!(plan(10, 10), Plan::Verify);
        assert_eq!(plan(11, 10), Plan::Fresh);
    }

    #[test]
    fn sha256_of_known_input() {
        let dir = test_dir();
        let path = dir.join("abc");
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha256_file(&path).unwrap(), ABC_SHA);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn complete_partial_is_verified_without_network() {
        let dir = test_dir();
        let entry = entry(3, ABC_SHA);
        std::fs::write(part_path(&dir, entry), b"abc").unwrap();
        let mut reports = Vec::new();
        let path = download(&dir, entry, &AtomicBool::new(false), |p| reports.push(p)).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"abc");
        assert!(!part_path(&dir, entry).exists());
        assert_eq!(reports.last().map(|p| p.downloaded), Some(3));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn checksum_mismatch_discards_partial() {
        let dir = test_dir();
        let entry = entry(3, ABC_SHA);
        std::fs::write(part_path(&dir, entry), b"abd").unwrap();
        let err = download(&dir, entry, &AtomicBool::new(false), |_| {}).unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(!part_path(&dir, entry).exists());
        assert!(!dir.join(entry.file).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn short_partial_is_kept_for_resume() {
        let dir = test_dir();
        let entry = entry(3, ABC_SHA);
        let part = part_path(&dir, entry);
        std::fs::write(&part, b"ab").unwrap();
        assert!(finalize(&part, &dir.join(entry.file), entry).is_err());
        assert!(part.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_ignores_missing_files() {
        let dir = test_dir();
        let entry = entry(3, ABC_SHA);
        std::fs::write(dir.join(entry.file), b"abc").unwrap();
        delete(&dir, entry).unwrap();
        delete(&dir, entry).unwrap();
        assert!(!dir.join(entry.file).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
